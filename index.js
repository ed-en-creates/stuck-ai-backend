const express = require('express');
const { OpenAI } = require('openai');

const app = express();

const nvidiaAI = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1', 
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/whatsapp', async (req, res) => {
    const userMessage = req.body.Body || '';
    console.log(`🚀 Sending to Ultra-Fast Llama: ${userMessage}`);

    try {
        const response = await nvidiaAI.chat.completions.create({
            model: "meta/llama-3-8b-instruct", // Lightweight, lightning-fast model
            messages: [
                { 
                    role: "system", 
                    content: "You are Stuck AI, an assistant for African commuters. Keep your response under two short sentences. Be incredibly brief and warm." 
                },
                { role: "user", content: userMessage }
            ],
            max_tokens: 80 // Hard limit on response length to ensure it returns in under 2 seconds
        });

        const aiReply = response.choices[0].message.content;
        console.log(`✅ AI Response Generated: ${aiReply}`);

        const twimlResponse = `
            <Response>
                <Message>${aiReply}</Message>
            </Response>
        `;

        res.header('Content-Type', 'text/xml');
        res.status(200).send(twimlResponse);

    } catch (error) {
        console.error("❌ NVIDIA API Error:", error);
        const errorResponse = `
            <Response>
                <Message>Oops! Brain traffic jam. Send your text again!</Message>
            </Response>
        `;
        res.header('Content-Type', 'text/xml');
        res.status(200).send(errorResponse);
    }
});

app.get('/', (req, res) => {
    res.send('Stuck AI Server is optimized and flying with fast Llama!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
