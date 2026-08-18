// auto-token.js
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios"); // Install using: npm install axios

const envFilePath = path.join(__dirname, '.env');

async function renewDhanToken() {
    const clientId = process.env.DHAN_CLIENT_ID;
    const oldToken = process.env.DHAN_ACCESS_TOKEN;

    if (!clientId || !oldToken) {
        console.log("❌ Error: Client ID ya Old Token .env file mein nahi mila.");
        return;
    }

    console.log("🔄 Dhan Token Auto-Renew Process Started...");

    try {
        // Dhan ke Renew Token API ko call karna
        const response = await axios({
            method: 'POST',
            url: 'https://api.dhan.co/v2/RenewToken',
            headers: {
                'client-id': clientId,
                'access-token': oldToken,
                'Content-Type': 'application/json'
            }
        });

        const newToken = response.data.token;

        if (newToken) {
            // Naye token ko .env file mein save karna
            let envConfig = fs.readFileSync(envFilePath, 'utf8');
            
            // Purane token ko naye token se replace karna
            envConfig = envConfig.replace(
                new RegExp(`DHAN_ACCESS_TOKEN=${oldToken}`, 'g'), 
                `DHAN_ACCESS_TOKEN=${newToken}`
            );
            
            fs.writeFileSync(envFilePath, envConfig);
            process.env.DHAN_ACCESS_TOKEN = newToken; // Live server mem mein bhi update
            
            console.log("✅ SUCCESS: Naya Dhan Token mil gaya aur .env file me update ho gaya!");
        } else {
            console.log("❌ Failed: Dhan API se token nahi mila.", response.data);
        }

    } catch (error) {
        console.error("❌ API Error:", error.response ? error.response.data : error.message);
    }
}

// Har 12 ghante (43,200,000 milliseconds) mein ye script apne aap chalegi
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
setInterval(renewDhanToken, TWELVE_HOURS);

// Pehli baar server start hote hi 5 second baad ek test run karega
setTimeout(renewDhanToken, 5000);

module.exports = { renewDhanToken };