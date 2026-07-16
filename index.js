const express = require('express');
const app = express();

// Tell our server to understand data sent by WhatsApp/Twilio
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// This is our main WhatsApp pathway (Webhook)
app.post('/whatsapp', (req, res) => {
    // 1. Grab the message the user sent
    const userMessage = req.body.Body || '';
    
    console.log(`Received message: ${userMessage}`);

    // 2. Draft a simple reply
    const replyMessage = `Stuck AI received your message: "${userMessage}". We are building the engine right now!`;

    // 3. Format the reply so Twilio understands it (using XML)
    const twimlResponse = `
        <Response>
            <Message>${replyMessage}</Message>
        </Response>
    `;

    // 4. Send the reply back to Twilio
    res.header('Content-Type', 'text/xml');
    res.status(200).send(twimlResponse);
});

// A basic homepage check to ensure our server is alive
app.get('/', (req, res) => {
    res.send('Stuck AI Server is active and running!');
});

// Start the server on the port Render assigns us
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
