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
    console.log(`Processing with Llama: ${userMessage}`);

    try {
        const response = await nvidiaAI.chat.completions.create({
            model: "meta/llama-3.3-70b-instruct", 
            messages: [
                { 
                    role: "system", 
                    content: "You are Stuck AI, an intelligent traffic assistant for commuters in Africa. Keep your answers brief, warm, helpful, and conversational. You don't have access to live maps yet, so if asked about specific current traffic, politely explain that you are currently learning the roads." 
                },
                { role: "user", content: userMessage }
            ],
        });

        const aiReply = response.choices[0].message.content;

        const twimlResponse = `
            <Response>
                <Message>${aiReply}</Message>
            </Response>
        `;

        res.header('Content-Type', 'text/xml');
        res.status(200).send(twimlResponse);

    } catch (error) {
        console.error("NVIDIA API Error:", error);
        const errorResponse = `
            <Response>
                <Message>Oops! My brain hit a temporary traffic jam. Try texting me again in a moment.</Message>
            </Response>
        `;
        res.header('Content-Type', 'text/xml');
        res.status(200).send(errorResponse);
    }
});

app.get('/', (req, res) => {
    res.send('Stuck AI Server is active and running for free with NVIDIA NIM!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
