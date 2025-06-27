// Complete Polar Flow API Integration
// Ready to deploy on Render

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Your Polar credentials
const POLAR_CONFIG = {
    clientId: 'd3281d51-278a-4da4-8db3-8f67f1ee13f3',
    clientSecret: 'b7e5057a-8e37-401c-842f-c39545cbb49a',
    redirectUri: process.env.NODE_ENV === 'production' 
        ? 'https://your-app-name.onrender.com/auth/polar/callback'
        : 'http://localhost:3000/auth/polar/callback',
    baseUrl: 'https://polarremote.com/v2',
    accessLinkUrl: 'https://www.polaraccesslink.com/v3'
};

// In-memory storage (use Redis/DB in production)
const userTokens = new Map();
const userSessions = new Map();

class PolarIntegration {
    constructor(config) {
        this.config = config;
    }

    // Step 1: Generate authorization URL
    getAuthUrl(userId) {
        const state = crypto.randomBytes(32).toString('hex');
        userSessions.set(state, { userId, timestamp: Date.now() });
        
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            scope: 'accesslink.read_all',
            state: state
        });
        
        return `${this.config.baseUrl}/oauth2/authorization?${params}`;
    }

    // Step 2: Exchange authorization code for access token
    async exchangeCodeForToken(code, state) {
        try {
            const session = userSessions.get(state);
            if (!session) {
                throw new Error('Invalid state parameter');
            }

            const response = await fetch(`${this.config.baseUrl}/oauth2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: this.config.redirectUri,
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Token exchange failed: ${response.status} - ${error}`);
            }

            const tokenData = await response.json();
            
            // Store token for the user
            userTokens.set(session.userId, {
                accessToken: tokenData.access_token,
                tokenType: tokenData.token_type,
                expiresIn: tokenData.expires_in,
                timestamp: Date.now()
            });

            // Clean up session
            userSessions.delete(state);

            return tokenData;

        } catch (error) {
            console.error('Token exchange error:', error);
            throw error;
        }
    }

    // Step 3: Register user with AccessLink
    async registerUser(userId) {
        const userToken = userTokens.get(userId);
        if (!userToken) {
            throw new Error('No access token found for user');
        }

        try {
            const response = await fetch(`${this.config.accessLinkUrl}/users`, {
                method: 'POST',
                headers: {
                    'Authorization': `${userToken.tokenType} ${userToken.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    'member-id': userId
                })
            });

            if (response.status === 409) {
                console.log('User already registered');
                return { status: 'already_registered' };
            }

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`User registration failed: ${response.status} - ${error}`);
            }

            const userData = await response.json();
            console.log('✅ User registered with AccessLink');
            return userData;

        } catch (error) {
            console.error('User registration error:', error);
            throw error;
        }
    }

    // Get user's activity data
    async getActivityData(userId) {
        const userToken = userTokens.get(userId);
        if (!userToken) {
            throw new Error('No access token found for user');
        }

        try {
            // Get available activity transactions
            const transactionsResponse = await fetch(`${this.config.accessLinkUrl}/users/${userId}/activity-transactions`, {
                headers: {
                    'Authorization': `${userToken.tokenType} ${userToken.accessToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!transactionsResponse.ok) {
                throw new Error(`Activity transactions failed: ${transactionsResponse.status}`);
            }

            const transactions = await transactionsResponse.json();
            console.log(`📊 Found ${transactions['activity-log']?.length || 0} activity transactions`);

            // Get detailed activity data for each transaction
            const activityPromises = (transactions['activity-log'] || []).map(async (transaction) => {
                const activityResponse = await fetch(transaction.url, {
                    headers: {
                        'Authorization': `${userToken.tokenType} ${userToken.accessToken}`,
                        'Accept': 'application/json'
                    }
                });

                if (activityResponse.ok) {
                    return await activityResponse.json();
                }
                return null;
            });

            const activities = await Promise.all(activityPromises);
            return activities.filter(activity => activity !== null);

        } catch (error) {
            console.error('Activity data error:', error);
            throw error;
        }
    }

    // Get user's exercise data (workouts)
    async getExerciseData(userId) {
        const userToken = userTokens.get(userId);
        if (!userToken) {
            throw new Error('No access token found for user');
        }

        try {
            // Get available exercise transactions
            const transactionsResponse = await fetch(`${this.config.accessLinkUrl}/users/${userId}/exercise-transactions`, {
                headers: {
                    'Authorization': `${userToken.tokenType} ${userToken.accessToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!transactionsResponse.ok) {
                throw new Error(`Exercise transactions failed: ${transactionsResponse.status}`);
            }

            const transactions = await transactionsResponse.json();
            console.log(`💪 Found ${transactions['exercises']?.length || 0} exercise transactions`);

            // Get detailed exercise data
            const exercisePromises = (transactions['exercises'] || []).map(async (transaction) => {
                const exerciseResponse = await fetch(transaction.url, {
                    headers: {
                        'Authorization': `${userToken.tokenType} ${userToken.accessToken}`,
                        'Accept': 'application/json'
                    }
                });

                if (exerciseResponse.ok) {
                    return await exerciseResponse.json();
                }
                return null;
            });

            const exercises = await Promise.all(exercisePromises);
            return exercises.filter(exercise => exercise !== null);

        } catch (error) {
            console.error('Exercise data error:', error);
            throw error;
        }
    }

    // Get comprehensive health data
    async getAllHealthData(userId) {
        try {
            console.log(`🔄 Fetching all health data for user ${userId}`);
            
            const [activities, exercises] = await Promise.all([
                this.getActivityData(userId),
                this.getExerciseData(userId)
            ]);

            // Process and combine the data
            const healthData = {
                userId,
                timestamp: new Date().toISOString(),
                summary: {
                    totalActivities: activities.length,
                    totalExercises: exercises.length,
                    dataFreshness: 'real-time'
                },
                activities: activities.map(activity => ({
                    date: activity.date,
                    calories: activity['active-calories'],
                    steps: activity.steps,
                    distance: activity.distance,
                    duration: activity['active-time']
                })),
                exercises: exercises.map(exercise => ({
                    id: exercise.id,
                    startTime: exercise['start-time'],
                    sport: exercise.sport,
                    duration: exercise.duration,
                    calories: exercise.calories,
                    heartRate: {
                        average: exercise['heart-rate']?.average,
                        maximum: exercise['heart-rate']?.maximum
                    },
                    trainingLoad: exercise['training-load']
                })),
                insights: this.generatePolarInsights(activities, exercises)
            };

            console.log('✅ All Polar data processed successfully');
            return healthData;

        } catch (error) {
            console.error('Get all health data error:', error);
            throw error;
        }
    }

    // Generate insights from Polar data
    generatePolarInsights(activities, exercises) {
        const insights = [];
        
        if (exercises.length > 0) {
            const latestExercise = exercises[exercises.length - 1];
            const exerciseTime = new Date(latestExercise['start-time']);
            const hoursAgo = (Date.now() - exerciseTime.getTime()) / (1000 * 60 * 60);
            
            if (hoursAgo < 4) {
                insights.push({
                    type: 'recent_workout',
                    message: `Great ${latestExercise.sport} workout ${Math.round(hoursAgo)} hours ago! You burned ${latestExercise.calories} calories.`,
                    data: latestExercise
                });
            }
        }
        
        if (activities.length > 0) {
            const todayActivity = activities[activities.length - 1];
            if (todayActivity.steps > 10000) {
                insights.push({
                    type: 'step_goal',
                    message: `Awesome! You've hit ${todayActivity.steps} steps today! 🎯`,
                    data: todayActivity
                });
            }
        }
        
        return insights;
    }
}

// Initialize Polar integration
const polar = new PolarIntegration(POLAR_CONFIG);

// API Routes
app.get('/', (req, res) => {
    res.send(`
        <h1>🏃‍♂️ Polar Health Integration</h1>
        <p><a href="/auth/polar">Connect Your Polar Account</a></p>
        <p><a href="/health-data/test-user">View Sample Health Data</a></p>
        <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            h1 { color: #667eea; }
            a { color: #667eea; text-decoration: none; background: #f0f0f0; padding: 10px 20px; border-radius: 5px; display: inline-block; margin: 10px 0; }
            a:hover { background: #667eea; color: white; }
        </style>
    `);
});

// Start Polar authorization
app.get('/auth/polar', (req, res) => {
    const userId = req.query.user || 'test-user';
    const authUrl = polar.getAuthUrl(userId);
    res.redirect(authUrl);
});

// Handle Polar callback
app.get('/auth/polar/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;
        
        if (error) {
            return res.status(400).json({ error: `Authorization failed: ${error}` });
        }
        
        if (!code || !state) {
            return res.status(400).json({ error: 'Missing authorization code or state' });
        }

        // Exchange code for token
        const tokenData = await polar.exchangeCodeForToken(code, state);
        
        // Register user with AccessLink
        const session = userSessions.get(state) || { userId: 'test-user' };
        await polar.registerUser(session.userId);
        
        res.json({
            success: true,
            message: 'Polar account connected successfully!',
            userId: session.userId,
            nextStep: `/health-data/${session.userId}`
        });

    } catch (error) {
        console.error('Callback error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get user's health data
app.get('/health-data/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userTokens.has(userId)) {
            return res.status(401).json({ 
                error: 'User not authenticated',
                authUrl: `/auth/polar?user=${userId}`
            });
        }

        const healthData = await polar.getAllHealthData(userId);
        res.json(healthData);

    } catch (error) {
        console.error('Health data error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Polar Health Integration running on port ${PORT}`);
    console.log(`📱 Visit your app to start!`);
    console.log(`🔑 Polar Client ID: ${POLAR_CONFIG.clientId}`);
});

export default app;
