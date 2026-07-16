require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Helper function to get travel time from Geoapify
async function getRouteDetails(startLat, startLon, endLat, endLon) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  const url = `https://api.geoapify.com/v1/routing?waypoints=${startLat},${startLon}|${endLat},${endLon}&mode=drive&apiKey=${apiKey}`;

  try {
    const response = await axios.get(url);
    if (response.data && response.data.features && response.data.features.length > 0) {
      const properties = response.data.features[0].properties;
      
      // Geoapify returns distance in meters and time in seconds
      const distanceKm = (properties.distance / 1000).toFixed(1);
      const timeMinutes = Math.round(properties.time / 60);

      return { distanceKm, timeMinutes };
    }
    return null;
  } catch (error) {
    console.error('❌ Geoapify Routing Error:', error.response?.data || error.message);
    return null;
  }
}

// WhatsApp Webhook Endpoint
app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const fromNumber = req.body.From; // User's WhatsApp phone number
  
  // Extract Coordinates from Twilio WhatsApp Location payload
  const latitude = req.body.Latitude;
  const longitude = req.body.Longitude;

  console.log(`✉️ Received message from ${fromNumber}: "${incomingMsg}"`);

  // Create empty Twilio TwiML response
  let twimlResponse = '<?xml version="1.0" encoding="UTF-8"?><Response>';

  if (latitude && longitude) {
    console.log(`📍 Received location pin: Lat ${latitude}, Lon ${longitude}`);

    try {
      // 1. Save to Supabase
      const { data, error } = await supabase
        .from('user_routes')
        .upsert(
          { 
            phone_number: fromNumber, 
            latitude: parseFloat(latitude), 
            longitude: parseFloat(longitude),
            updated_at: new Date()
          }, 
          { onConflict: 'phone_number' }
        );

      if (error) {
        throw error;
      }

      console.log('✅ Coordinates successfully saved/updated in Supabase!');

      // 2. Demo Route Calculation (e.g., routing to a dummy Office coordinate for testing)
      // Let's set a demo target location in Benin City (e.g., King's Square / Ring Road: 6.3350, 5.6222)
      const officeLat = 6.3350;
      const officeLon = 5.6222;

      const route = await getRouteDetails(latitude, longitude, officeLat, officeLon);

      let replyMessage = '';
      if (route) {
        replyMessage = `Awesome! I've pinned this location as your Home address 🏠.\n\n🚗 *Commute Check:*\nTo get to Ring Road from here is about *${route.distanceKm} km* and will take you *${route.timeMinutes} mins* in current traffic.`;
      } else {
        replyMessage = `Awesome! I've pinned this location as your Home address 🏠. (However, I couldn't calculate the live route times right now. I'll monitor it!)`;
      }

      twimlResponse += `<Message>${replyMessage}</Message>`;

    } catch (dbError) {
      console.error('❌ Supabase Save Error:', dbError);
      twimlResponse += `<Message>Received your location pin, but had trouble saving it to my memory map. Try again!</Message>`;
    }

  } else {
    // Standard AI Brain Conversation (Groq)
    try {
      const groqResponse = await axios.post(
        'https://api.groq.com/openapi/v1/chat/completions',
        {
          model: 'llama3-8b-8192',
          messages: [
            { 
              role: 'system', 
              content: 'You are Stuck AI, a friendly local traffic assistant. Keep answers brief, under 2 sentences.' 
            },
            { role: 'user', content: incomingMsg }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const aiReply = groqResponse.data.choices[0].message.content;
      twimlResponse += `<Message>${aiReply}</Message>`;

    } catch (aiError) {
      console.error('❌ Groq AI Error:', aiError.message);
      twimlResponse += `<Message>Oops, my brain stalled for a second. Try saying that again!</Message>`;
    }
  }

  twimlResponse += '</Response>';
  res.set('Content-Type', 'text/xml');
  res.send(twimlResponse);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Stuck AI server is running on port ${PORT}`);
});
