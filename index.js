const express = require('express');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 1. Initialize Groq AI 
const groqAI = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1', 
});

// 2. Initialize Supabase Database
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 3. Helper function to get travel time from Geoapify using native fetch
async function getRouteDetails(startLat, startLon, endLat, endLon) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  const url = `https://api.geoapify.com/v1/routing?waypoints=${startLat},${startLon}|${endLat},${endLon}&mode=drive&apiKey=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.features && data.features.length > 0) {
      const properties = data.features[0].properties;
      const distanceKm = (properties.distance / 1000).toFixed(1);
      const timeMinutes = Math.round(properties.time / 60);
      return { distanceKm, timeMinutes };
    }
    return null;
  } catch (error) {
    console.error('❌ Geoapify Routing Error:', error.message);
    return null;
  }
}

// 4. Main WhatsApp Endpoint
app.post('/whatsapp', async (req, res) => {
    const fromNumber = req.body.From || ''; 
    const rawMessage = req.body.Body || '';
    const userMessage = rawMessage.trim();

    // Support BOTH lowercase and uppercase coordinate parameters sent by Twilio
    const latitude = req.body.Latitude || req.body.latitude || null;
    const longitude = req.body.Longitude || req.body.longitude || null;

    console.log(`📩 Incoming payload from ${fromNumber}. Text: "${userMessage}"`);

    // FLOW A: User drops an actual location pin
    if (latitude && longitude) {
        console.log(`📍 Received Coordinates: Lat: ${latitude}, Lng: ${longitude}`);
        
        try {
            // Save to Supabase
            await supabase.from('user_routes').insert([{
                phone_number: fromNumber,
                location_type: 'home',
                latitude: String(latitude),
                longitude: String(longitude),
                address: 'Shared WhatsApp Pin'
            }]);

            // Demo Route Calculation (Target: Ring Road, Benin City: 6.3350, 5.6222)
            const targetLat = 6.3350;
            const targetLon = 5.6222;

            const route = await getRouteDetails(latitude, longitude, targetLat, targetLon);

            let replyMessage = '';
            if (route) {
                replyMessage = `Awesome! I've pinned this location as your Home address 🏠.\n\n🚗 *Commute Check:*\nTo get to Ring Road from here is about *${route.distanceKm} km* and will take you *${route.timeMinutes} mins* in current traffic.`;
            } else {
                replyMessage = `Awesome! I've pinned this location as your Home address 🏠. (However, I couldn't calculate the live route times right now. I'll monitor it!)`;
            }

            const twiml = `<Response><Message>${replyMessage}</Message></Response>`;
            res.header('Content-Type', 'text/xml');
            return res.status(200).send(twiml);

        } catch (error) {
            console.error("❌ Process Error:", error);
            const twiml = `<Response><Message>Received your location pin, but had trouble saving it to my memory map. Try again!</Message></Response>`;
            res.header('Content-Type', 'text/xml');
            return res.status(200).send(twiml);
        }
    }

    // FLOW B: Standard conversational traffic message
    try {
        // Send contextual prompt to Groq
        const response = await groqAI.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { 
                    role: "system", 
                    content: `You are Stuck AI, a warm, helpful mobility assistant for commuters exclusively in Benin City, Edo State, Nigeria. Do not suggest routes in Lagos. Keep responses under two sentences. If they ask about routing times, instruct them to send a WhatsApp Location Pin.` 
                },
                { role: "user", content: userMessage }
            ],
            max_tokens: 120,
            temperature: 0.7
        });

        const aiReply = response.choices[0].message.content.trim();
        const twimlResponse = `<Response><Message>${aiReply}</Message></Response>`;

        res.header('Content-Type', 'text/xml');
        return res.status(200).send(twimlResponse);

    } catch (error) {
        console.error("❌ AI Error:", error);
        const errorResponse = `<Response><Message>Oops! Brain traffic jam. Send your text again!</Message></Response>`;
        res.header('Content-Type', 'text/xml');
        return res.status(200).send(errorResponse);
    }
});

// Basic server home route for health monitoring
app.get('/', (req, res) => {
    res.send('🚀 Stuck AI MVP with Geoapify Engine is live!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Stuck AI server is up and running on port ${PORT}`);
});
