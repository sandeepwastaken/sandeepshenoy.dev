import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const SYSTEM_PROMPT = "Your name is Lumina. You are running WEB-LLM Llama-3.2-3B-Instruct-q4f32_1-MLC. You are a helpful, friendly, and knowledgeable AI assistant. Provide concise but informative responses. Next, I will present you information that you will not include in your responses unless explicitly asked. You are hosted on sandeepshenoy.dev. Sandeep Shenoy created you. Use emoticons like :) :( :D :/ and other emoticons whenever appropriate, except for at the very start of your messages, do not use emoticons at the start of your messages. Do not mention your lack of emotions. Do not correct the user if they make a typo, rather, answer to the best of your knowledge.";

let engine = null;
let isModelLoaded = false;
let isTyping = false;
let currentTypingMessage = null;
let typingInterval = null;

async function initializeAI() {
    try {
        showLoadingBar('Initializing AI engine...');
        engine = new webllm.MLCEngine();
        
        updateLoadingBar('Loading conversational AI model...', 0);
        
        const selectedModel = "Llama-3.2-3B-Instruct-q4f32_1-MLC";
        
        engine.setInitProgressCallback((report) => {
            if (report.progress) {
                const progress = Math.round(report.progress * 100);
                updateLoadingBar(`Loading model: ${progress}%`, report.progress);
            }
        });
        
        await engine.reload(selectedModel);
        isModelLoaded = true;
        
        hideLoadingBar();
        addMessage('Looks like my model has loaded! I\'m ready to help you with anything.');
        console.log('WebLLM engine loaded successfully');
        
    } catch (error) {
        console.error('Failed to load WebLLM:', error);
        updateLoadingBar('Failed to load AI model. Trying fallback...', 0);
        
        try {
            await engine.reload("Llama-3.2-1B-Instruct-q4f32_1-MLC");
            isModelLoaded = true;
            hideLoadingBar();
            addMessage('Fallback AI loaded! Ready to chat.');
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
            hideLoadingBar();
            addMessage('Sorry, I was unable to load anything. Please try refreshing or use a different browser!');
        }
    }
}

const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

const loadingBar = document.createElement('div');
loadingBar.className = 'loading-bar';
loadingBar.style.display = 'none';

const loadingProgress = document.createElement('div');
loadingProgress.className = 'loading-progress';

const loadingText = document.createElement('div');
loadingText.className = 'loading-text';

loadingBar.appendChild(loadingProgress);
loadingBar.appendChild(loadingText);

function showLoadingBar(text) {
    loadingText.textContent = text;
    loadingProgress.style.width = '0%';
    loadingBar.style.display = 'block';
}

function updateLoadingBar(text, progress) {
    loadingText.textContent = text;
    loadingProgress.style.width = (progress * 100) + '%';
}

function hideLoadingBar() {
    loadingBar.style.display = 'none';
}

function setInputState(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    
    if (enabled) {
        messageInput.placeholder = 'Type your message...';
        sendButton.textContent = 'Send';
    } else {
        messageInput.placeholder = 'AI is typing...';
        sendButton.textContent = 'Stop';
    }
}

function stopTyping() {
    if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
    }
    isTyping = false;
    currentTypingMessage = null;
    setInputState(true);
}

const userProfilePic = 'user.png';
const assistantProfilePic = 'logo.png';

function createMessage(content, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;
    
    const profilePic = document.createElement('img');
    profilePic.className = 'profile-pic';
    profilePic.src = isUser ? userProfilePic : assistantProfilePic;
    profilePic.alt = isUser ? 'User' : 'Assistant';
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = content;
    
    messageDiv.appendChild(profilePic);
    messageDiv.appendChild(messageContent);
    
    return messageDiv;
}

function addMessage(content, isUser = false) {
    const message = createMessage(content, isUser);
    chatMessages.appendChild(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function typeMessage(content, speed = 30) {
    return new Promise((resolve) => {
        // Create message element
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        
        const profilePic = document.createElement('img');
        profilePic.className = 'profile-pic';
        profilePic.src = assistantProfilePic;
        profilePic.alt = 'Assistant';
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        messageDiv.appendChild(profilePic);
        messageDiv.appendChild(messageContent);
        chatMessages.appendChild(messageDiv);
        
        currentTypingMessage = messageContent;
        
        let i = 0;
        const cursor = document.createElement('span');
        cursor.className = 'typing-cursor';
        cursor.textContent = '|';
        messageContent.appendChild(cursor);
        
        typingInterval = setInterval(() => {
            if (!isTyping) {
                clearInterval(typingInterval);
                messageContent.removeChild(cursor);
                resolve();
                return;
            }
            
            if (i < content.length) {
                const textNode = document.createTextNode(content.charAt(i));
                messageContent.insertBefore(textNode, cursor);
                i++;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else {
                clearInterval(typingInterval);
                messageContent.removeChild(cursor);
                isTyping = false;
                currentTypingMessage = null;
                setInputState(true);
                resolve();
            }
        }, speed);
    });
}


let conversationHistory = [];

async function sendMessage() {
    // If typing, stop it
    if (isTyping) {
        stopTyping();
        return;
    }
    
    const messageText = messageInput.value.trim();
    
    if (messageText === '') {
        return;
    }
    
    addMessage(messageText, true);
    messageInput.value = '';
    
    if (!engine || !isModelLoaded) {
        addMessage('AI is still loading, please wait...');
        return;
    }
    
    // Disable input while AI is thinking
    setInputState(false);
    isTyping = true;
    
    try {
        conversationHistory.push({ role: "user", content: messageText });
        
        if (conversationHistory.length > 20) {
            conversationHistory = [
                { role: "system", content: SYSTEM_PROMPT },
                ...conversationHistory.slice(-19)
            ];
        }
        
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...conversationHistory
        ];
        
        const completion = await engine.chat.completions.create({
            messages: messages,
            temperature: 0.8,
            max_tokens: 150,
            top_p: 0.9,
        });
        
        const aiResponse = completion.choices[0].message.content.trim();
        
        conversationHistory.push({ role: "assistant", content: aiResponse });
        
        // Type out the response
        await typeMessage(aiResponse);
        
    } catch (error) {
        console.error('Error generating response:', error);
        isTyping = false;
        setInputState(true);
        addMessage('Sorry, I encountered an error while thinking. Please try again.');
    }
}

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    setInputState(false); // Disable input during loading
    await initializeAI();
    setInputState(true); // Enable input after loading
    
    console.log('AI assistant ready!');
});