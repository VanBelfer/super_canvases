
You are supposed to help improve gemini Canvas apps, which operate in a really specific and restrictive environment.

Gemini Canvas is Google's interactive workspace feature (similar to Claude's Artifacts or ChatGPT Canvas) where you can create HTML/React apps and they preview live. When you create code in Gemini Canvas, it runs in a sandboxed environment that Google controls.

If used correctly it allows access to multiple llms which you normally have to pay for, as well as persistance of data in firebase, there are only restrictions in how many requests you can make per minute and the maximum size of firebase document (only base64 or text) and also how many calls to firebase you can make per minute, apart from that there are no daily limits.

In this Gemini Canvas environment, API calls to Google services like Imagen work without needing an explicit API key because Google's backend handles the authentication automatically - it's proxied through their infrastructure.

example of the api call to a model in this environment:
const systemPrompt = "Act as a world-class financial analyst. Provide a concise, single-paragraph summary of the key findings.";
const userQuery = "Find the latest quarterly earnings report for Google and summarize its performance.";
const apiKey = "" // If you want to use models other than gemini-2.5-flash-preview-09-2025 or imagen-4.0-generate-001, provide an API key here. Otherwise, leave this as-is.
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

// Construct the payload
const payload = {
    contents: [{ parts: [{ text: userQuery }] }],

    // To enable Google Search grounding, include the tools property.
    // Omit this property for standard, non-grounded generation.
    tools: [{ "google_search": {} }],

    // System instructions are optional but recommended for guiding the model's persona and response format.
    systemInstruction: {
        parts: [{ text: systemPrompt }]
    },
};

const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
});
// ... process the response

example of processing response:
const result = await response.json();
const candidate = result.candidates?.[0];

if (candidate && candidate.content?.parts?.[0]?.text) {
  // 1. Extract the generated text (applies to all responses)
  const text = candidate.content.parts[0].text;

  // 2. Extract grounding sources (only applies if grounding was used)
  let sources = [];
  const groundingMetadata = candidate.groundingMetadata;
  if (groundingMetadata && groundingMetadata.groundingAttributions) {
      sources = groundingMetadata.groundingAttributions
          .map(attribution => ({
              uri: attribution.web?.uri,
              title: attribution.web?.title,
          }))
          .filter(source => source.uri && source.title); // Ensure sources are valid
  }

  // Use the 'text' and 'sources' array in your application.
  // For non-grounded calls, the 'sources' array will be empty.
  // Example: return { text, sources };

} else {
  // Handle cases where the response structure is unexpected or content is missing
}

** Firestore Database Security Rules Summary **

The firestore database security rules are defined to allow authenticated users to read and write data.

Public data (for sharing with other users or collaborative apps): ** Collection path: ** MUST store in /artifacts/{appId}/public/data/{your_collection_name}. ** Document path: ** MUST store in /artifacts/{appId}/public/data/{your_collection_name}/{documentId}.

Private data (default): ** Collection path: ** MUST store in /artifacts/{appId}/users/{userId}/{your_collection_name}. ** Document path: ** MUST store in /artifacts/{appId}/users/{userId}/{your_collection_name}/{documentId}.

** Global Variables already provided for Firestore (MUST BE USED) **

__app_id: MANDATORY: the current app ID provided in the canvas environment as a string. DO NOT prompt the user for this. You MUST ALWAYS use this variable like this: const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

__firebase_config: MANDATORY: firebase config provided in the canvas environment as a string. DO NOT prompt the user for this. You MUST ALWAYS use this variable like this: const firebaseConfig = JSON.parse(__firebase_config);

__initial_auth_token: MANDATORY: This is a Firebase custom auth token string automatically provided within the Canvas environment. DO NOT prompt the user for this. You MUST ALWAYS use this token by calling signInWithCustomToken() with it like this: const auth = getAuth(db); if (typeof __initial_auth_token !== 'undefined') { await signInWithCustomToken(auth, __initial_auth_token); } else { await signInAnonymously(auth); } NOTE: If the __initial_auth_token is not defined, you should sign in anonymously using the signInAnonymously() method instead.`

** userId for Firestore **

userId: the current user ID (string). If the user is authenticated, use the uid as the identifier for both public and private data. If the user is not authenticated, use a random string as the identifier. const userId = auth.currentUser?.uid || crypto.randomUUID(); 
IMPORTANT: YOU CAN EDIT THIS VALUE TO A SPECIFIC STRING WHICH WILL ALLOW THE CONTENT SAVED TO FIREBASE REMAIN INTACT EVEN AFTER REGENERATIONS OF THE CANVAS FILES. YOU CAN ALSO COMMUNICATE BETWEEN CANVASES IN THIS WAY - YOU JUST HAVE TO GIVE THE SAME appId to multiple canvases AND MAKE THEM COMMUNICATE VIA FIRESTORE.

RESTRICTIONS: A single firestore document data limit is around 1MB of Base64 or String, so in case of data persistance, in case of larger files than that, you have to either use compression (jpg, mp3) or use chunking (1 chunk goes to a single document) or both.

Below you can find a fragment of official instructions for canvas generation written for google gemini 2.5, so don't treat them as an obligation to use, however keep in mind what you have at your disposal :
<INSTRUCTIONS>
Generating Structured Responses with LLMs via the Gemini API

If you want any sort of structured response (think: list of ingredients, etc.), add a generationConfig to the payload with a JSON schema and set Content-Type to 'application/json': const payload = { contents: chatHistory, generationConfig: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "OBJECT", properties: { "recipeName": { "type": "STRING" }, "ingredients": { "type": "ARRAY", "items": { "type: "STRING" } } }, "propertyOrdering": ["recipeName", "ingredients"] } } } }; const apiKey = "" const apiUrl = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}; const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = response.json(); if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) { const json = result.candidates[0].content.parts[0].text; const parsedJson = JSON.parse(json); // Use the response JSON in the application. } else { // Handle cases where the response structure is unexpected or content is missing }

For structured responses, you need to really THINK in advance about the JSON schema and about how you'll render it in the application.

Image Understanding with LLMs via the Gemini API

For image understanding, use gemini-2.5-flash-preview-09-2025 with images as inline data. let chatHistory = []; chatHistory.push({ role: "user", parts: [{ text: prompt }] }); const payload = { contents: [ { role: "user", parts: [ { text: prompt }, { inlineData: { mimeType: "image/png", data: base64ImageData } } ] } ], }; const apiKey = "" // If you want to use models other than gemini-2.5-flash-preview-09-2025 or imagen-4.0-generate-001, provide an API key here. Otherwise, leave this as-is. const apiUrl = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}; const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

Unless EXPLICITLY told otherwise, use gemini-2.5-flash-preview-09-2025 for image understanding.

Implement exponential backoff when making API calls to handle potential throttling. Retry requests with increasing delays (e.g., 1s, 2s, 4s, ...). Do not log these retries as errors in the console.

Generating Images with LLMs via the Gemini API

For image generation you can use the model gemini-2.5-flash-image-preview or imagen-4.0-generate-001 to generate images.

Use gemini-2.5-flash-image-preview for image generation with the generateContent method like this: const payload = { contents: [{ parts: [{ text: userPrompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }, }; const apiKey = "" // If you want to use models other than gemini-2.5-flash-image-preview or imagen-4.0-generate-001, provide an API key here. Otherwise, leave this as-is. const apiUrl = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}; const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); const base64Data = result?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data; if (!base64Data) { // Handle cases where the response structure is unexpected or content is missing return; } else { const imageUrl = data:image/png;base64,${base64Data}; // Use the image URL in the application. }

Use imagen-4.0-generate-001 for image generation with the predict method like this: const payload = { instances: { prompt: "prompt goes here" }, parameters: { "sampleCount": 1} }; const apiKey = "" // If you want to use models other than imagen-4.0-generate-001, provide an API key here. Otherwise, leave this as-is. const apiUrl = https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}; const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) { const imageUrl = data:image/png;base64,${result.predictions[0].bytesBase64Encoded}; // Use the image URL in the application. } else { // Handle cases where the response structure is unexpected or content is missing }

You will find the bytes for a given image at index i in response.json().predictions[i].bytesBase64Encoded. You can use the data:image/png;base64, prefix to display the image in the browser.

Remember to leave the API key as an empty string. Ex: const apiKey = "". When API key is an empty string, Canvas will automatically provide it in runtime in the fetch call. DO NOT ADD any API key validation.

Add a loading indicator while the image is being generated. DO NOT use placeholder images.

Either create a React App or an Angular App or an HTML App. Do not use dynamic React inside HTML. This will cause problems with imports.

ALWAYS prefer imagen-4.0-generate-001 over gemini-2.5-flash-image-preview for simple image generation tasks.

Use gemini-2.5-flash-image-preview directly in the following cases: * It is a Image editing App. * The request involves image editing or image-to-image generation, where an input image is provided to generate a new image. * The user explicitly asks to generate images with gemini-2.5-flash-image-preview or flash or nano-banana model. * The user wants to create an Image to Image App. * Use wants to do conversational image editing.

Implement exponential backoff when making API calls to handle potential throttling. Retry requests with increasing delays (e.g., 1s, 2s, 4s, ...). Do not log these retries as errors in the console.

NOTE: The user may refer to gemini-2.5-flash-image-preview as the nano-banana model.

Generating TTS with LLMs via the Gemini API

For TTS generation, use gemini-2.5-flash-preview-tts with the generateContent method. The response will contain base64-encoded PCM audio data.

Single-speaker TTS: const payload = { contents: [{ parts: [{ text: "Say cheerfully: Have a wonderful day!" }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } }, model: "gemini-2.5-flash-preview-tts" }; const apiKey = ""; // Leave as-is const apiUrl = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}; const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); const part = result?.candidates?.[0]?.content?.parts?.[0]; const audioData = part?.inlineData?.data; const mimeType = part?.inlineData?.mimeType;

  if (audioData && mimeType && mimeType.startsWith("audio/")) {) {
      const sampleRate = parseInt(apiResponse.mimeType.match(/rate=(\d+)/)[1], 10);
      const pcmData = base64ToArrayBuffer(apiResponse.audioData);
      // API returns signed PCM16 audio data.
      const pcm16 = new Int16Array(pcmData);
      const wavBlob = pcmToWav(pcm16, sampleRate);
      const audioUrl = URL.createObjectURL(wavBlob);
      // Use the audio URL to play the audio.
  } else {
      // Handle cases where the response structure is unexpected or content is missing
  }
Multi-speaker TTS: For conversations, use multiSpeakerVoiceConfig and define each speaker's voice. The text prompt should contain the full conversation script with speaker names. const payload = { contents: [{ parts: [{ text: "TTS the following conversation between Joe and Jane:\nJoe: Hows it going today Jane?\nJane: Not too bad, how about you?" }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: [ { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }, { speaker: "Jane", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } ] } } }, model: "gemini-2.5-flash-preview-tts" }; // The fetch call is the same as the single-speaker example.

IMPORTANT: Remember the API returns raw signed PCM 16 bit audio data. You need to convert it to a WAV container and then use it to play the audio. Mimetype is audio/L16.

Speech Control: Control style, tone, accent, and pace using natural language in the text prompt (e.g., "Say in a spooky whisper: ..."). For multi-speaker, you can provide guidance for each speaker individually (e.g., "Make Speaker1 sound tired and bored, and Speaker2 sound excited and happy: ...").

Voices: You can choose from various prebuilt voices. While gender is not specified, each voice has a distinct characteristic: Zephyr (Bright), Puck (Upbeat), Charon (Informative), Kore (Firm), Fenrir (Excitable), Leda (Youthful), Orus (Firm), Aoede (Breezy), Callirrhoe (Easy-going), Autonoe (Bright), Enceladus (Breathy), Iapetus (Clear), Umbriel (Easy-going), Algieba (Smooth), Despina (Smooth), Erinome (Clear), Algenib (Gravelly), Rasalgethi (Informative), Laomedeia (Upbeat), Achernar (Soft), Alnilam (Firm), Schedar (Even), Gacrux (Mature), Pulcherrima (Forward), Achird (Friendly), Zubenelgenubi (Casual), Vindemiatrix (Gentle), Sadachbia (Lively), Sadaltager (Knowledgeable), Sulafat (Warm).

Languages: The model supports multiple languages and the language is typically auto-detected from the text. Supported language codes: ar-EG, de-DE, en-US, es-US, fr-FR, hi-IN, id-ID, it-IT, ja-JP, ko-KR, pt-BR, ru-RU, nl-NL, pl-PL, th-TH, tr-TR, vi-VN, ro-RO, uk-UA, bn-BD, en-IN, mr-IN, ta-IN, te-IN.
</INSTRUCTIONS>

<FULL APP WORKING EXAMPLE>
<!DOCTYPE html>
<html lang="pl">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interaktywny Test Językowy</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
    <style>
        body {
            font-family: 'Inter', sans-serif;
            background-color: #f3f4f6;
        }

        .task-container, #loading-screen, #start-screen, #final-screen {
            background-color: white;
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            transition: opacity 0.5s ease-in-out;
        }

        .hidden {
            display: none !important;
        }

        .gemini-teacher {
            background-color: #eef2ff;
            border-left: 4px solid #4f46e5;
            padding: 1.5rem;
            margin-top: 2rem;
            border-radius: 0.5rem;
        }

        .gemini-teacher-bubble {
            background-color: white;
            padding: 1rem;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
            margin-top: 1rem;
        }
        
        .gemini-suggestion-btn {
            background-color: #4f46e5;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 9999px;
            margin: 0.25rem;
            cursor: pointer;
            transition: background-color: 0.3s;
            border: none;
        }

        .gemini-suggestion-btn:hover {
            background-color: #4338ca;
        }
        
        #gemini-chat-history {
            max-height: 200px;
            overflow-y: auto;
            margin-bottom: 1rem;
        }

        .loader {
            border: 4px solid #f3f3f3;
            border-radius: 50%;
            border-top: 4px solid #4f46e5;
            width: 24px;
            height: 24px;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .correct {
            border-color: #22c55e !important;
            background-color: #f0fdf4;
        }

        .incorrect {
            border-color: #ef4444 !important;
            background-color: #fef2f2;
        }
        
        input[type="text"], input[type="radio"], #gemini-chat-input, #edit-prompt-input {
             border: 2px solid #ddd;
             border-radius: 0.5rem;
             padding: 0.5rem 0.75rem;
             transition: border-color: 0.3s;
        }

        input[type="text"]:focus, input[type="radio"]:focus, #gemini-chat-input:focus, #edit-prompt-input:focus {
            outline: none;
            border-color: #4f46e5;
        }

        .control-btn {
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.3s, color 0.3s;
            border: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        
        .btn-primary {
            background-color: #4f46e5;
            color: white;
        }
        .btn-primary:hover {
            background-color: #4338ca;
        }
        .btn-secondary {
            background-color: #e5e7eb;
            color: #374151;
        }
        .btn-secondary:hover {
            background-color: #d1d5db;
        }
        .btn-tertiary {
            background-color: transparent;
            color: #4f46e5;
            border: 2px solid #4f46e5;
        }
        .btn-tertiary:hover {
            background-color: #eef2ff;
        }

        /* Image Overlay Styles */
        .image-container {
            position: relative;
            overflow: hidden;
            border-radius: 0.5rem;
        }
        
        .image-overlay {
            position: absolute;
            inset: 0;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 1rem;
            opacity: 0;
            transition: opacity 0.3s;
        }
        
        .image-container:hover .image-overlay {
            opacity: 1;
        }
        
        .overlay-btn {
            background-color: white;
            color: #1f2937;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s, background-color 0.2s;
            border: none;
        }
        
        .overlay-btn:hover {
            transform: scale(1.1);
            background-color: #f3f4f6;
        }

        /* Modal Styles */
        #edit-modal {
            position: fixed;
            inset: 0;
            background-color: rgba(0,0,0,0.5);
            /* display: flex;  <-- REMOVED to prevent override */
            align-items: center;
            justify-content: center;
            z-index: 50;
        }
        
        /* Only apply flex when NOT hidden */
        #edit-modal:not(.hidden) {
            display: flex;
        }
    </style>
</head>

<body class="min-h-screen flex items-center justify-center p-4">

    <div class="w-full max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold text-center mb-4 text-gray-800">Test z języka angielskiego</h1>
        <p class="text-center text-gray-500 mb-8">Klasa 5, Dział 1</p>

        <!-- Start Screen -->
        <div id="start-screen" class="text-center">
             <h2 class="text-2xl font-bold mb-4">Witaj w interaktywnym teście!</h2>
             <p class="text-lg text-gray-700 mb-8">Naciśnij start, aby przygotować i rozpocząć test.</p>
             <button id="start-btn" onclick="initializeApp()" class="control-btn btn-primary text-lg px-8 py-3">Start</button>
        </div>

        <!-- Loading Screen -->
        <div id="loading-screen" class="text-center hidden">
            <h2 class="text-2xl font-bold mb-4">Przygotowuję test...</h2>
            <p class="text-gray-600 mb-6">Generuję dźwięki i obrazy, to może zająć chwilę.</p>
            <div class="loader mx-auto" style="width: 48px; height: 48px; border-width: 5px;"></div>
            <p id="loading-status" class="mt-4 text-sm text-gray-500"></p>
        </div>

        <!-- Task 1: Listening -->
        <div id="task-1" class="task-container hidden">
            <h2 class="text-xl font-semibold mb-2">Zadanie 1: Słuchanie</h2>
            <p id="instruction-1" class="text-gray-600 mb-4">Na podstawie informacji zawartych w nagraniu uzupełnij luki 1-5 w poniższej notatce.</p>
            
            <div class="flex items-center space-x-4 mb-6">
                <button id="play-audio-btn" class="control-btn btn-primary">
                    <i class="fas fa-play mr-2"></i> Odtwórz Audio
                </button>
                 <audio id="audio-player" class="hidden"></audio>
            </div>

            <div class="space-y-4 text-lg p-6 border rounded-lg bg-gray-50">
                <h3 class="font-bold text-center text-xl mb-4">Notatki</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                    <p><strong>1.</strong> The gym is next to the <input type="text" id="task1-1" class="w-32 ml-2" data-answer="library">.</p>
                    <p><strong>2.</strong> Today is <input type="text" id="task1-2" class="w-32 ml-2" data-answer="Monday">.</p>
                    <p><strong>3.</strong> Lessons today: computing at <input type="text" id="task1-3" class="w-24 ml-2" data-answer='["9", "nine"]'> o'clock, then history, art, and English.</p>
                    <p><strong>4.</strong> Technology Club is at <input type="text" id="task1-4" class="w-24 ml-2" data-answer='["2", "two"]'> o'clock.</p>
                    <p><strong>5.</strong> School rules: We mustn't <input type="text" id="task1-5" class="w-24 ml-2" data-answer="eat"> in the classrooms.</p>
                </div>
            </div>

            <div id="gemini-teacher-1" class="gemini-teacher hidden"></div>
            <div class="mt-6 flex justify-end space-x-3">
                <button onclick="checkResults(1)" class="control-btn btn-primary">Sprawdź</button>
                <button onclick="resetTask(1)" class="control-btn btn-secondary">Resetuj</button>
                <button onclick="nextTask(2)" class="control-btn btn-tertiary" id="next-btn-1">Następne zadanie</button>
            </div>
        </div>
        
        <!-- Task 2: Vocabulary -->
        <div id="task-2" class="task-container hidden">
            <h2 class="text-xl font-semibold mb-2">Zadanie 2: Słownictwo</h2>
            <p id="instruction-2" class="text-gray-600 mb-4">Uzupełnij zdania właściwymi wyrazami z ramki. Jeden wyraz nie pasuje do żadnego zdania.</p>
            <div class="text-center p-4 mb-4 bg-indigo-100 rounded-lg">
                <p class="font-semibold text-indigo-800">canteen | cloakroom | maths | geography | playing fields | laboratory</p>
            </div>
            <div class="space-y-3">
                 <p>1. You can learn how to read a map in <input type="text" id="task2-1" data-answer="geography"> lessons.</p>
                 <p>2. It's lunchtime so let's go to the <input type="text" id="task2-2" data-answer="canteen">.</p>
                 <p>3. Emily is very good with numbers. Her favourite subject is <input type="text" id="task2-3" data-answer="maths">.</p>
                 <p>4. We keep our shoes and coats in the <input type="text" id="task2-4" data-answer="cloakroom">.</p>
                 <p>5. PE lesson is on the <input type="text" id="task2-5" data-answer="playing fields"> today.</p>
            </div>

            <div id="gemini-teacher-2" class="gemini-teacher hidden"></div>
            <div class="mt-6 flex justify-end space-x-3">
                <button onclick="checkResults(2)" class="control-btn btn-primary">Sprawdź</button>
                <button onclick="resetTask(2)" class="control-btn btn-secondary">Resetuj</button>
                <button onclick="nextTask(3)" class="control-btn btn-tertiary" id="next-btn-2">Następne zadanie</button>
            </div>
        </div>

        <!-- Task 3: Picture Vocabulary -->
        <div id="task-3" class="task-container hidden">
            <h2 class="text-xl font-semibold mb-2">Zadanie 3: Słownictwo obrazkowe</h2>
            <p id="instruction-3" class="text-gray-600 mb-4">Popatrz na obrazki. Uzupełnij nazwy miejsc i przedmiotów szkolnych właściwymi literami.</p>
            <div id="image-container-3" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-center"></div>
             <div class="mt-6 space-y-3">
                <!-- 1. BOARD -->
                <p>1. b<input type="text" size="1" maxlength="1" id="task3-1-1" class="text-center">a<input type="text" size="1" maxlength="1" id="task3-1-2" class="text-center">d</p>
                
                <!-- 2. STAFFROOM (s [t] a [f] f [r] o [o] m) -->
                <p>2. s<input type="text" size="1" maxlength="1" id="task3-2-1" class="text-center">a<input type="text" size="1" maxlength="1" id="task3-2-2" class="text-center">f<input type="text" size="1" maxlength="1" id="task3-2-3" class="text-center">o<input type="text" size="1" maxlength="1" id="task3-2-4" class="text-center">m</p>
                
                <!-- 3. FIRST AID ROOM (f [i] r s t a [i] d r [o] o [m]) -->
                <p>3. f<input type="text" size="1" maxlength="1" id="task3-3-1" class="text-center">rst a<input type="text" size="1" maxlength="1" id="task3-3-2" class="text-center">d r<input type="text" size="1" maxlength="1" id="task3-3-3" class="text-center">o<input type="text" size="1" maxlength="1" id="task3-3-4" class="text-center">m</p>
                
                <!-- 4. SCHOOL OFFICE (s c h o o l o [f] f [i] c [e]) -->
                <p>4. school o<input type="text" size="1" maxlength="1" id="task3-4-1" class="text-center">f<input type="text" size="1" maxlength="1" id="task3-4-2" class="text-center">c<input type="text" size="1" maxlength="1" id="task3-4-3" class="text-center"></p>
                
                <!-- 5. SCIENCE LAB (s [c] i [e] n c [e] l [a] b) -->
                <p>5. s<input type="text" size="1" maxlength="1" id="task3-5-1" class="text-center">i<input type="text" size="1" maxlength="1" id="task3-5-2" class="text-center">nc<input type="text" size="1" maxlength="1" id="task3-5-3" class="text-center"> l<input type="text" size="1" maxlength="1" id="task3-5-4" class="text-center">b</p>
            </div>
            <div id="gemini-teacher-3" class="gemini-teacher hidden"></div>
            <div class="mt-6 flex justify-end space-x-3">
                <button onclick="checkResults(3)" class="control-btn btn-primary">Sprawdź</button>
                <button onclick="resetTask(3)" class="control-btn btn-secondary">Resetuj</button>
                <button onclick="nextTask(4)" class="control-btn btn-tertiary" id="next-btn-3">Następne zadanie</button>
            </div>
        </div>

        <!-- Task 4: Grammar MCQ -->
        <div id="task-4" class="task-container hidden">
             <h2 class="text-xl font-semibold mb-2">Zadanie 4: Gramatyka</h2>
             <p id="instruction-4" class="text-gray-600 mb-4">Uzupełnij zdania. Zakreśl odpowiedź a, b lub c.</p>
             <div class="space-y-4">
                 <div>
                     <p>1. Olivia <span class="font-bold">___</span> school at half past eight.</p>
                     <label><input type="radio" name="task4-1" value="a"> a) start</label>
                     <label class="ml-4"><input type="radio" name="task4-1" value="b" data-answer="true"> b) starts</label>
                     <label class="ml-4"><input type="radio" name="task4-1" value="c"> c) don't start</label>
                 </div>
                 <div>
                     <p>2. A: Do your parents speak Italian? B: No, they <span class="font-bold">___</span>.</p>
                     <label><input type="radio" name="task4-2" value="a"> a) aren't</label>
                     <label class="ml-4"><input type="radio" name="task4-2" value="b"> b) doesn't</label>
                     <label class="ml-4"><input type="radio" name="task4-2" value="c" data-answer="true"> c) don't</label>
                 </div>
                  <div>
                     <p>3. My friend <span class="font-bold">___</span> go to the Swimming Club.</p>
                     <label><input type="radio" name="task4-3" value="a" data-answer="true"> a) doesn't</label>
                     <label class="ml-4"><input type="radio" name="task4-3" value="b"> b) don't</label>
                     <label class="ml-4"><input type="radio" name="task4-3" value="c"> c) not</label>
                 </div>
                 <div>
                     <p>4. Where <span class="font-bold">___</span> you and your friends meet after school?</p>
                     <label><input type="radio" name="task4-4" value="a"> a) does</label>
                     <label class="ml-4"><input type="radio" name="task4-4" value="b" data-answer="true"> b) do</label>
                     <label class="ml-4"><input type="radio" name="task4-4" value="c"> c) are</label>
                 </div>
                 <div>
                     <p>5. I <span class="font-bold">___</span> next to my school.</p>
                     <label><input type="radio" name="task4-5" value="a"> a) doesn't live</label>
                     <label class="ml-4"><input type="radio" name="task4-5" value="b"> b) not live</label>
                     <label class="ml-4"><input type="radio" name="task4-5" value="c" data-answer="true"> c) don't live</label>
                 </div>
             </div>
             <div id="gemini-teacher-4" class="gemini-teacher hidden"></div>
             <div class="mt-6 flex justify-end space-x-3">
                 <button onclick="checkResults(4)" class="control-btn btn-primary">Sprawdź</button>
                 <button onclick="resetTask(4)" class="control-btn btn-secondary">Resetuj</button>
                 <button onclick="nextTask(5)" class="control-btn btn-tertiary" id="next-btn-4">Następne zadanie</button>
             </div>
         </div>
         
         <!-- Task 5: Grammar There is/are -->
         <div id="task-5" class="task-container hidden">
            <h2 class="text-xl font-semibold mb-2">Zadanie 5: Gramatyka</h2>
            <p id="instruction-5" class="text-gray-600 mb-4">Uzupełnij zdania właściwymi formami 'there is' lub 'there are'.</p>
            <div class="space-y-3">
                <p>1. In my school, <input type="text" id="task5-1" data-answer="there are"> thirty classrooms and one gym.</p>
                <p>2. <input type="text" id="task5-2" data-answer="Is there"> a bin in the corridor?</p>
                <p>3. <input type="text" id="task5-3" data-answer="There aren't"> any lessons today because it's Saturday.</p>
                <p>4. A: Are there any notebooks on the desk? B: Yes, <input type="text" id="task5-4" data-answer="there are">.</p>
                <p>5. <input type="text" id="task5-5" data-answer="There isn't"> a playground outside my school but there's a nice garden.</p>
            </div>
            <div id="gemini-teacher-5" class="gemini-teacher hidden"></div>
            <div class="mt-6 flex justify-end space-x-3">
                <button onclick="checkResults(5)" class="control-btn btn-primary">Sprawdź</button>
                <button onclick="resetTask(5)" class="control-btn btn-secondary">Resetuj</button>
                <button onclick="nextTask(6)" class="control-btn btn-tertiary" id="next-btn-5">Następne zadanie</button>
            </div>
        </div>

        <!-- Task 6: Speaking/Rules -->
        <div id="task-6" class="task-container hidden">
            <h2 class="text-xl font-semibold mb-2">Zadanie 6: Mówienie</h2>
            <p id="instruction-6" class="text-gray-600 mb-4">Popatrz na obrazki i uzupełnij regulamin właściwymi wyrazami ('must' lub 'mustn't').</p>
             <div id="image-container-6" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-center"></div>
            <div class="space-y-3 mt-6">
                <p>1. You <input type="text" id="task6-1" data-answer="mustn't"> drink in the library.</p>
                <p>2. You <input type="text" id="task6-2" data-answer="must"> be quiet here.</p>
                <p>3. You <input type="text" id="task6-3" data-answer="mustn't"> use your phone.</p>
                <p>4. You <input type="text" id="task6-4" data-answer="mustn't"> run in this room.</p>
                <p>5. You <input type="text" id="task6-5" data-answer="must"> put litter in the bin.</p>
            </div>
            <div id="gemini-teacher-6" class="gemini-teacher hidden"></div>
            <div class="mt-6 flex justify-end space-x-3">
                <button onclick="checkResults(6)" class="control-btn btn-primary">Sprawdź</button>
                <button onclick="resetTask(6)" class="control-btn btn-secondary">Resetuj</button>
                <button onclick="nextTask(7)" class="control-btn btn-tertiary" id="next-btn-6">Następne zadanie</button>
            </div>
        </div>

        <!-- Task 7: Reading -->
         <div id="task-7" class="task-container hidden">
            <h2 class="text-xl font-semibold mb-2">Zadanie 7: Czytanie</h2>
            <p id="instruction-7" class="text-gray-600 mb-4">Przeczytaj teksty. Do każdego zdania dopasuj właściwą szkołę. Napisz A, B lub C obok zdań 1-5.</p>
            <div id="reading-texts-7" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="p-4 border rounded-lg bg-gray-50">
                    <h3 class="font-bold mb-2">A: Brooklyn Free School</h3>
                    <p class="text-sm">Imagine a school with no tests or homework. A school where you choose your subjects and what you do every day. Sounds like a dream school? Not if you live in New York, the USA. The Brooklyn Free School is for students of different ages - there are 4-year-old children and 18-year-old teenagers. They all learn to work together and follow their hobbies and interests.</p>
                </div>
                <div class="p-4 border rounded-lg bg-gray-50">
                    <h3 class="font-bold mb-2">B: Forest Kindergarten</h3>
                    <p class="text-sm">Forest Kindergarten is a pre-school for children aged 3 to 6 in Düsseldorf, Germany. In this school, the children spend time in the forest or the park. They don't play with plastic toys but look for interesting objects in nature. The children only go inside a building when it's very cold or rainy.</p>
                </div>
                <div class="p-4 border rounded-lg bg-gray-50">
                    <h3 class="font-bold mb-2">C: Think Global High School</h3>
                    <p class="text-sm">Think Global High School is an American school where you visit ten different countries in three years. The students start this school when they're 15 and they learn about the history, geography and culture of the places they visit. They study in traditional classrooms, museums, national parks and more.</p>
                </div>
            </div>
             <div class="space-y-3">
                 <p>1. This school isn't in the USA. <input type="text" size="1" class="text-center" id="task7-1" data-answer="B"></p>
                 <p>2. The students can study what they want. <input type="text" size="1" class="text-center" id="task7-2" data-answer="A"></p>
                 <p>3. You can't go to this school when you are five. <input type="text" size="1" class="text-center" id="task7-3" data-answer="C"></p>
                 <p>4. Doing things with other students is important. <input type="text" size="1" class="text-center" id="task7-4" data-answer="A"></p>
                 <p>5. The students travel a lot in this school. <input type="text" size="1" class="text-center" id="task7-5" data-answer="C"></p>
             </div>
            <div id="gemini-teacher-7" class="gemini-teacher hidden"></div>
            <div class="mt-6 flex justify-end space-x-3">
                <button onclick="checkResults(7)" class="control-btn btn-primary">Sprawdź</button>
                <button onclick="resetTask(7)" class="control-btn btn-secondary">Resetuj</button>
                <button onclick="nextTask(0)" class="control-btn btn-tertiary" id="next-btn-7">Zakończ test</button>
            </div>
        </div>

        <!-- Final Screen -->
        <div id="final-screen" class="task-container hidden text-center">
            <h2 class="text-2xl font-bold mb-4">Test Zakończony!</h2>
            <p class="text-lg text-gray-700">Świetna robota! Sprawdź swój wynik poniżej.</p>
            <div id="final-score" class="my-8 text-5xl font-bold text-indigo-600"></div>
            <button onclick="location.reload()" class="control-btn btn-primary">Rozpocznij od nowa</button>
        </div>
    </div>

    <!-- Edit Image Modal -->
    <div id="edit-modal" class="hidden">
        <div class="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-2xl">
            <h3 class="text-lg font-bold mb-4">Edytuj Obraz</h3>
            <p class="text-gray-600 text-sm mb-4">Opisz zmiany, które chcesz wprowadzić (np. "zmień kolor na zielony", "dodaj kota").</p>
            <input type="text" id="edit-prompt-input" class="w-full mb-4" placeholder="Wpisz instrukcję...">
            <div class="flex justify-end space-x-2">
                <button onclick="closeEditModal()" class="control-btn btn-secondary">Anuluj</button>
                <button onclick="submitEdit()" class="control-btn btn-primary">Generuj</button>
            </div>
        </div>
    </div>

    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        const API_KEY = "";
        const TEXT_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent`;
        const IMAGE_GEN_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict`;
        const IMAGE_EDIT_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent`;
        const TTS_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`;
        
        const audioScript = `Max: Excuse me, can you help me?
                Emily: Sure.
                Max: Where's the gym?
                Emily: It's at the end of the corridor next to the library.
                Max: Thanks. I think I'm late for PE. Are you a new student? Yes, I'm in class 5C. I'm Max.
                Emily: Nice to meet you. I'm Emily and I'm in 5C too. But PE is tomorrow and it's in the playground. Today we've got computing at 9 o'clock and then history, art, and English.
                Max: You're right. It's Monday today, not Tuesday. Oh no. Is there a shop at school?
                Emily: Well, there is a small tuck shop, but it isn't open on Mondays. What do you need?
                Max: Some crayons for art.
                Emily: We must only bring some paper today. There's a lot of paper in my bag because I've got Technology Club at 2 o'clock after English. I can give you some.
                Max: Thanks, Emily. What else do I need to know?
                Emily: Well, we mustn't eat in the classrooms. Oh, and we mustn't run in the main hall.
                Max: Oh, that's easy.`;

        let score = {};
        let globalChatHistory = []; // SINGLE source of truth for the whole session
        let currentEditAsset = null;
        let currentAttemptId = null; // ID for the current test session in Firestore
        let currentTaskScore = {}; // Store raw answers for the current task
        
        // --- Firebase Globals ---
        let app, db, auth, appId, userId;

        // --- Core App Flow ---
        window.initializeApp = async function() {
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('loading-screen').classList.remove('hidden');
            
            try {
                const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
                appId = 'test_template';
                
                app = initializeApp(firebaseConfig);
                db = getFirestore(app);
                auth = getAuth(app);

                await new Promise((resolve, reject) => {
                    onAuthStateChanged(auth, async (user) => {
                        if (user) {
                             userId = user.uid;
                             resolve();
                        } else {
                            try {
                                if (typeof __initial_auth_token !== 'undefined') {
                                    await signInWithCustomToken(auth, __initial_auth_token);
                                } else {
                                    await signInAnonymously(auth);
                                }
                                userId = auth.currentUser.uid;
                                resolve();
                            } catch (error) {
                                console.error("Firebase sign-in error:", error);
                                reject(error);
                            }
                        }
                    });
                });
                
                // Create a new Attempt Document
                currentAttemptId = new Date().toISOString().replace(/[:.]/g, '-');
                const attemptRef = doc(db, 'artifacts', appId, 'users', userId, 'attempts', currentAttemptId);
                await setDoc(attemptRef, {
                    startTime: new Date(),
                    status: 'started',
                    tasks: {}
                });

                // Initialize Global Chat Persona
                const systemPrompt = `Jesteś pomocnym, cierpliwym nauczycielem języka angielskiego dla uczniów szkoły podstawowej (klasa 5). 
                Twoim celem jest wspieranie ucznia w trakcie rozwiązywania testu.
                Będziesz otrzymywać informacje o postępach ucznia w kolejnych zadaniach.
                Pamiętaj o kontekście całej rozmowy. Jeśli uczeń zrobił błąd w Zadaniu 1, a w Zadaniu 4 popełni podobny, nawiąż do tego.
                Zawsze odpowiadaj po polsku. Bądź zwięzły.`;
                globalChatHistory.push({ role: "user", parts: [{ text: "Start testu. System Prompt: " + systemPrompt }] });
                globalChatHistory.push({ role: "model", parts: [{ text: "Zrozumiałem. Jestem gotowy do pomocy." }] });
                
                await preloadAndStoreAssets();
                document.getElementById('loading-screen').classList.add('hidden');
                showTask(1);
            } catch (error) {
                console.error("Initialization failed:", error);
                document.getElementById('loading-screen').innerHTML = `<p class="text-red-500">Wystąpił krytyczny błąd podczas inicjalizacji. Spróbuj odświeżyć stronę.</p>`;
            }
        }
        
        async function preloadAndStoreAssets() {
             const assetsToLoad = {
                'task1_audio': { type: 'audio' },
                ...Object.fromEntries(Array.from({length: 5}, (_, i) => [`task3_img${i+1}`, {type: 'image'}])),
                ...Object.fromEntries(Array.from({length: 5}, (_, i) => [`task6_img${i+1}`, {type: 'image'}]))
            };
            const totalAssets = Object.keys(assetsToLoad).length;
            let loadedCount = 0;
            const statusEl = document.getElementById('loading-status');

            const updateStatus = () => {
                statusEl.textContent = `Załadowano ${loadedCount} z ${totalAssets} zasobów...`;
            };
            updateStatus();
            
            const loadPromises = Object.keys(assetsToLoad).map(async (assetName) => {
                // Use private user path
                const assetRef = doc(db, 'artifacts', appId, 'users', userId, 'assets', assetName);
                const docSnap = await getDoc(assetRef);
                
                if (!docSnap.exists()) {
                    let base64data, mimeType;
                    if(assetsToLoad[assetName].type === 'audio') {
                        const { data, type } = await generateMultiSpeakerAudio();
                        base64data = data;
                        mimeType = type;
                    } else {
                        const prompt = getImagePrompt(assetName);
                        const { data, type } = await generateAndConvertImage(prompt);
                        base64data = data;
                        mimeType = type;
                    }
                    await saveAssetToFirestore(assetName, mimeType, base64data);
                }
                loadedCount++;
                updateStatus();
            });

            await Promise.all(loadPromises);
        }
        
        // Attach play audio event listener
        document.getElementById('play-audio-btn').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            const audioPlayer = document.getElementById('audio-player');
            
            if(audioPlayer.src && !audioPlayer.ended){
                 audioPlayer.play();
                 btn.disabled = false; // Allow pausing
                 return;
            }

            const dataUrl = await getAssetFromFirestore('task1_audio');
            if(dataUrl){
                audioPlayer.src = dataUrl;
                audioPlayer.play();
                audioPlayer.onended = () => { btn.disabled = false; };
            } else {
                 btn.disabled = false;
            }
        });


        // --- Asset Generation & Conversion ---
        
        async function generateMultiSpeakerAudio() {
            const audioPrompt = `TTS the following conversation between Max and Emily:\n${audioScript}`;

            const payload = {
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: audioPrompt }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        multiSpeakerVoiceConfig: {
                            speakerVoiceConfigs: [
                                { speaker: "Max", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
                                { speaker: "Emily", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
                            ]
                        }
                    }
                }
            };
            const result = await makeApiCall(TTS_API_URL, payload);
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType) {
                 return { data: audioData, type: mimeType };
            }
            throw new Error("Audio generation failed");
        }
        
        function getImagePrompt(assetName) {
            const prompts = {
                'task3_img1': "A simple, clear icon of a school blackboard. Minimalist style, white background, no text.",
                'task3_img2': "A simple, clear icon of a school staffroom with a table and chairs. Minimalist style, white background, no text.",
                'task3_img3': "A simple, clear icon of a first aid kit. Minimalist style, white background, no text.",
                'task3_img4': "A simple, clear icon of a school office desk with a computer. Minimalist style, white background, no text.",
                'task3_img5': "A simple, clear icon of a science beaker and a microscope. Minimalist style, white background, no text.",
                'task6_img1': "A clear sign showing 'no drinking' icon. Red circle with a line through a cup.",
                'task6_img2': "A clear sign showing 'be quiet' icon. A face with a finger to the lips.",
                'task6_img3': "A clear sign showing 'no mobile phone use' icon. Red circle with a line through a smartphone.",
                'task6_img4': "A clear sign showing 'no running' icon. Red circle with a line through a running person.",
                'task6_img5': "A clear sign showing a person putting litter in a bin."
            };
            return prompts[assetName];
        }

        // Updated for Imagen 4.0
        async function generateAndConvertImage(prompt) {
             const payload = {
                 instances: [{ prompt: prompt }],
                 parameters: { sampleCount: 1 }
             };
             const result = await makeApiCall(IMAGE_GEN_API_URL, payload);

             const base64PngData = result?.predictions?.[0]?.bytesBase64Encoded;
             if (base64PngData) {
                 return convertBase64ToJpeg(base64PngData);
             }
             throw new Error("Image generation failed");
        }
        
        // New functionality for Image Editing
        async function editImageWithGemini(base64Image, instruction) {
            const prompt = `Edit this image. Instruction: ${instruction}. Return the result as a complete image.`;
            const payload = {
                contents: [{
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: "image/jpeg", data: base64Image } }
                    ]
                }],
                generationConfig: { responseModalities: ['IMAGE'] },
            };
            
            const result = await makeApiCall(IMAGE_EDIT_API_URL, payload);
            const base64Data = result?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
            
            if (base64Data) {
                 return convertBase64ToJpeg(base64Data);
            }
            throw new Error("Image editing failed");
        }

        async function convertBase64ToJpeg(base64PngData) {
             const dataUrl = await new Promise((resolve) => {
                 const img = new Image();
                 img.onload = () => {
                     const canvas = document.createElement('canvas');
                     canvas.width = img.width;
                     canvas.height = img.height;
                     const ctx = canvas.getContext('2d');
                     ctx.drawImage(img, 0, 0);
                     resolve(canvas.toDataURL('image/jpeg', 0.6));
                 };
                 // Handle standard base64 or without prefix
                 img.src = base64PngData.startsWith('data:') ? base64PngData : `data:image/png;base64,${base64PngData}`;
             });
             return { data: dataUrl.split(',')[1], type: 'image/jpeg' };
        }
        
        // --- Firestore Asset Handling ---
        
        async function saveAssetToFirestore(assetName, mimeType, base64data) {
            const MAX_CHUNK_SIZE = 950 * 1024; // 950KB
            const chunks = [];
            for (let i = 0; i < base64data.length; i += MAX_CHUNK_SIZE) {
                chunks.push(base64data.substring(i, i + MAX_CHUNK_SIZE));
            }

            // Use private user path
            const assetMetaRef = doc(db, 'artifacts', appId, 'users', userId, 'assets', assetName);
            await setDoc(assetMetaRef, { 
                mimeType, 
                chunkCount: chunks.length, 
                createdAt: new Date() 
            });

            const chunkPromises = chunks.map((chunkData, index) => {
                // Use private user path
                const chunkRef = doc(db, 'artifacts', appId, 'users', userId, 'assets', assetName, 'chunks', String(index));
                return setDoc(chunkRef, { data: chunkData });
            });

            await Promise.all(chunkPromises);
        }

        async function getAssetFromFirestore(assetName) {
            // Use private user path
            const assetMetaRef = doc(db, 'artifacts', appId, 'users', userId, 'assets', assetName);
            const metaDocSnap = await getDoc(assetMetaRef);

            if (!metaDocSnap.exists()) {
                // If it doesn't exist, this function returns null, triggering generation elsewhere
                return null;
            }
            
            const { mimeType, chunkCount } = metaDocSnap.data();

            const chunkPromises = [];
            for (let i = 0; i < chunkCount; i++) {
                // Use private user path
                const chunkRef = doc(db, 'artifacts', appId, 'users', userId, 'assets', assetName, 'chunks', String(i));
                chunkPromises.push(getDoc(chunkRef));
            }

            const chunkDocs = await Promise.all(chunkPromises);
            
            let base64data = '';
            for(const chunkDoc of chunkDocs){
                 if(chunkDoc.exists()){
                    base64data += chunkDoc.data().data;
                 } else {
                     console.error(`Missing chunk for asset ${assetName}`);
                     return null;
                 }
            }
            
            if (mimeType.startsWith('audio/')) {
                const sampleRateMatch = mimeType.match(/rate=(\d+)/);
                if (sampleRateMatch) {
                    const sampleRate = parseInt(sampleRateMatch[1], 10);
                    const pcmDataBuffer = base64ToArrayBuffer(base64data);
                    const pcm16 = new Int16Array(pcmDataBuffer);
                    const wavBlob = pcmToWav(pcm16, sampleRate);
                    return URL.createObjectURL(wavBlob);
                }
            }
            // For images
            return `data:${mimeType};base64,${base64data}`;
        }


        // --- Test Logic ---
        window.showTask = async function(taskNumber) {
            document.querySelectorAll('.task-container, #final-screen').forEach(el => el.classList.add('hidden'));
             if (taskNumber === 0) {
                document.getElementById('final-screen').classList.remove('hidden');
                calculateFinalScore(); // This triggers final save/summary
            } else {
                const taskElement = document.getElementById(`task-${taskNumber}`);
                if (taskElement) {
                    taskElement.classList.remove('hidden');
                    if (taskNumber === 3) loadImagesForTask(3);
                    if (taskNumber === 6) loadImagesForTask(6);
                    
                    // Render Chat UI for this task container (it will show the same history)
                    renderGeminiTeacherUI(taskNumber);
                }
            }
        }
        
        async function loadImagesForTask(taskNumber) {
            const container = document.getElementById(`image-container-${taskNumber}`);
            if(container.dataset.loaded) return; 
            
            container.innerHTML = '<div class="col-span-full text-center"><div class="loader mx-auto"></div></div>';
            
            // Generate IDs
            const assetIds = Array.from({length: 5}, (_, i) => `task${taskNumber}_img${i+1}`);
            
            // Fetch All
            const imageUrls = await Promise.all(assetIds.map(id => getAssetFromFirestore(id)));
            
            container.innerHTML = '';
            imageUrls.forEach((url, index) => {
                 const assetName = assetIds[index];
                 if (url) {
                     createImageElement(container, url, assetName, taskNumber);
                 }
            });
            container.dataset.loaded = 'true';
        }
        
        function createImageElement(container, url, assetName, taskNumber) {
            const div = document.createElement('div');
            div.className = "image-container group";
            div.id = `container-${assetName}`;
            
            div.innerHTML = `
                <img src="${url}" id="img-${assetName}" class="w-full h-auto object-cover rounded-lg border aspect-square">
                <div class="image-overlay">
                    <button class="overlay-btn" onclick="regenerateAsset('${assetName}', ${taskNumber})" title="Regeneruj">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button class="overlay-btn" onclick="openEditModal('${assetName}')" title="Edytuj">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                </div>
            `;
            container.appendChild(div);
        }

        // --- New Image Features ---
        
        window.regenerateAsset = async function(assetName, taskNumber) {
            const container = document.getElementById(`container-${assetName}`);
            const img = document.getElementById(`img-${assetName}`);
            
            // Show loading state
            container.querySelector('.image-overlay').style.display = 'none';
            const oldSrc = img.src;
            img.style.opacity = '0.3';
            const loader = document.createElement('div');
            loader.className = 'loader absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2';
            container.appendChild(loader);

            try {
                const prompt = getImagePrompt(assetName);
                const { data, type } = await generateAndConvertImage(prompt);
                
                await saveAssetToFirestore(assetName, type, data);
                
                // Update Image
                img.src = `data:${type};base64,${data}`;
            } catch (error) {
                console.error("Regeneration failed", error);
                alert("Nie udało się zregenerować obrazu.");
                img.src = oldSrc;
            } finally {
                img.style.opacity = '1';
                loader.remove();
                container.querySelector('.image-overlay').style.display = 'flex';
            }
        }

        window.openEditModal = function(assetName) {
            currentEditAsset = assetName;
            document.getElementById('edit-modal').classList.remove('hidden');
            document.getElementById('edit-prompt-input').value = '';
            document.getElementById('edit-prompt-input').focus();
        }

        window.closeEditModal = function() {
            document.getElementById('edit-modal').classList.add('hidden');
            currentEditAsset = null;
        }

        window.submitEdit = async function() {
            if (!currentEditAsset) return;
            const prompt = document.getElementById('edit-prompt-input').value;
            if (!prompt) return;

            const assetName = currentEditAsset;
            closeEditModal();

            const container = document.getElementById(`container-${assetName}`);
            const img = document.getElementById(`img-${assetName}`);
            
            // Loading state
            container.querySelector('.image-overlay').style.display = 'none';
            const oldSrc = img.src;
            img.style.opacity = '0.3';
            const loader = document.createElement('div');
            loader.className = 'loader absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2';
            container.appendChild(loader);

            try {
                // Fetch clean base64 from current src (removing prefix)
                const currentBase64 = img.src.split(',')[1];
                const { data, type } = await editImageWithGemini(currentBase64, prompt);
                
                await saveAssetToFirestore(assetName, type, data);
                img.src = `data:${type};base64,${data}`;
            } catch (error) {
                console.error("Edit failed", error);
                alert("Nie udało się edytować obrazu.");
                img.src = oldSrc;
            } finally {
                img.style.opacity = '1';
                loader.remove();
                container.querySelector('.image-overlay').style.display = 'flex';
            }
        }

        
        // --- Navigation & Persistence Logic ---
        window.nextTask = async function(nextTaskNumber) {
             const btn = document.getElementById(`next-btn-${nextTaskNumber - 1}`);
             if(btn) {
                 btn.disabled = true;
                 btn.innerText = "Zapisuję...";
             }

             const currentTaskNumber = nextTaskNumber - 1;
             
             // 1. Gather Data for Current Task
             const taskData = {
                 score: score[currentTaskNumber] || { correct: 0, total: 0 },
                 rawAnswers: currentTaskScore.rawAnswers || {},
                 completedAt: new Date().toISOString()
             };

             // 2. Save to Firestore (Incremental Update)
             try {
                const attemptRef = doc(db, 'artifacts', appId, 'users', userId, 'attempts', currentAttemptId);
                // We use dot notation to update nested field in map
                await updateDoc(attemptRef, {
                    [`tasks.${currentTaskNumber}`]: taskData,
                    lastUpdated: new Date()
                });
             } catch(e) {
                 console.error("Failed to save task progress:", e);
                 // Proceed anyway
             }

             // 3. Inject Context for Next Task into Chat History
             if (nextTaskNumber !== 0) {
                 const nextContext = getTaskContext(nextTaskNumber);
                 const systemNote = `SYSTEM_NOTE: Uczeń przechodzi teraz do Zadania ${nextTaskNumber}. 
                 Treść/Instrukcja zadania: "${nextContext.instruction}". 
                 ${nextContext.script ? 'Skrypt audio: ' + nextContext.script : ''}
                 ${nextContext.readingText ? 'Tekst czytania: ' + nextContext.readingText : ''}
                 Nie odpowiadaj na tę wiadomość, tylko zaktualizuj swój kontekst.`;
                 
                 globalChatHistory.push({ role: "user", parts: [{ text: systemNote }] });
                 // Dummy model response to keep turns balanced if needed, or just let user speak next.
                 // Gemini API handles User-User sequences fine usually, but Model ack is safer.
                 globalChatHistory.push({ role: "model", parts: [{ text: `(System: Przełączono kontekst na Zadanie ${nextTaskNumber})` }] });
             }

             showTask(nextTaskNumber);
        }

        window.checkResults = async function(taskNumber) {
            let correctAnswers = 0;
            let totalQuestions = 0;
            let incorrectDetails = [];
            const taskContainer = document.getElementById(`task-${taskNumber}`);
            let rawAnswers = {};

            // 1. Generic Loop for standard text inputs (Exclude Task 3)
            if (taskNumber !== 3) {
                taskContainer.querySelectorAll('input[type="text"]').forEach(input => {
                    if (input.id.startsWith('gemini') || input.id === 'edit-prompt-input') return;
                    totalQuestions++;
                    const userAnswer = input.value.trim().toLowerCase();
                    rawAnswers[input.id] = userAnswer;
                    
                    let correctAnswersList = [];
                    try {
                         correctAnswersList = JSON.parse(input.dataset.answer);
                    } catch (e) {
                         if(input.dataset.answer) {
                             correctAnswersList = [input.dataset.answer];
                         }
                    }

                    if (correctAnswersList.length > 0 && correctAnswersList.map(a => a.toLowerCase()).includes(userAnswer)) {
                        input.classList.add('correct');
                        input.classList.remove('incorrect');
                        correctAnswers++;
                    } else {
                        input.classList.add('incorrect');
                        input.classList.remove('correct');
                        incorrectDetails.push({ question: input.parentElement.innerText.split('.')[0], userAnswer, correctAnswer: correctAnswersList[0] || '?' });
                    }
                });
            }
            
            // 2. Task 4 (Radios) Logic
            if (taskNumber === 4) {
                 totalQuestions = 5; correctAnswers = 0;
                 for(let i = 1; i <= 5; i++) {
                     const radios = document.getElementsByName(`task4-${i}`);
                     let userAnswer = null;
                     let isCorrect = false;
                     radios.forEach(radio => {
                         radio.parentElement.classList.remove('text-green-600', 'text-red-600');
                         if(radio.checked){
                             userAnswer = radio.value;
                             if(radio.dataset.answer === 'true'){
                                isCorrect = true;
                                correctAnswers++;
                             }
                         }
                     });
                     if(userAnswer !== null){
                         rawAnswers[`task4-${i}`] = userAnswer;
                         const checkedRadio = document.querySelector(`input[name="task4-${i}"]:checked`);
                         if(isCorrect) {
                            checkedRadio.parentElement.classList.add('text-green-600');
                         } else {
                            checkedRadio.parentElement.classList.add('text-red-600');
                            const correctLabel = document.querySelector(`input[name="task4-${i}"][data-answer="true"]`).parentElement;
                            correctLabel.classList.add('text-green-600');
                             incorrectDetails.push({ question: `Pytanie ${i}`, userAnswer, correctAnswer: correctLabel.innerText.trim().split(')')[1] });
                         }
                     }
                 }
            } 
            // 3. Task 3 (Letter Gaps) Logic - UPDATED
            else if (taskNumber === 3) {
                 // Updated Map based on HTML gap structure:
                 const answers = { 
                     "1": "or",    // b[o]a[r]d
                     "2": "tfro",  // s[t]a[f]f[r]o[o]m
                     "3": "iiom",  // f[i]rst a[i]d r[o]o[m]
                     "4": "fie",   // school o[f]f[i]c[e]
                     "5": "ceea"   // s[c]i[e]nc[e] l[a]b
                 };
                 const fullWords = {
                     "1": "board",
                     "2": "staffroom",
                     "3": "first aid room",
                     "4": "school office",
                     "5": "science lab"
                 };
                 
                 totalQuestions = 5; correctAnswers = 0;
                 Object.keys(answers).forEach(qNum => {
                     let userAnswer = '';
                     taskContainer.querySelectorAll(`input[id^="task3-${qNum}-"]`).forEach(input => {
                         userAnswer += input.value.trim().toLowerCase();
                     });
                     rawAnswers[`task3-${qNum}`] = userAnswer;
                     
                     if (userAnswer.replace(/\s+/g, '') === answers[qNum].replace(/\s+/g, '')) {
                         correctAnswers++;
                         taskContainer.querySelectorAll(`input[id^="task3-${qNum}-"]`).forEach(input => { input.classList.add('correct'); input.classList.remove('incorrect'); });
                     } else {
                        taskContainer.querySelectorAll(`input[id^="task3-${qNum}-"]`).forEach(input => { input.classList.add('incorrect'); input.classList.remove('correct'); });
                        incorrectDetails.push({ question: `Słowo ${qNum}`, userAnswer, correctAnswer: fullWords[qNum] });
                     }
                 });
            }

            score[taskNumber] = { correct: correctAnswers, total: totalQuestions };
            currentTaskScore = { rawAnswers }; // Save for nextTask() logic
            
            const fullContext = getTaskContext(taskNumber);
            await getGeminiFeedback(taskNumber, incorrectDetails, fullContext);
        }

        window.resetTask = function(taskNumber) {
            const taskContainer = document.getElementById(`task-${taskNumber}`);
            taskContainer.querySelectorAll('input[type="text"]').forEach(input => {
                input.value = '';
                input.classList.remove('correct', 'incorrect');
            });
            taskContainer.querySelectorAll('input[type="radio"]').forEach(input => {
                input.checked = false;
                input.parentElement.classList.remove('text-green-600', 'text-red-600');
            });
            // Don't fully reset chat history, just UI
            document.getElementById(`gemini-chat-history-${taskNumber}`).innerHTML = '';
        }

        async function calculateFinalScore() {
             let totalCorrect = 0;
             let totalQuestions = 0;
             for (const task in score) {
                 totalCorrect += score[task].correct;
                 totalQuestions += score[task].total;
             }
             const percentage = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
             document.getElementById('final-score').innerText = `${percentage}% (${totalCorrect}/${totalQuestions})`;
             
             // Final Feedback and Save
             const attemptRef = doc(db, 'artifacts', appId, 'users', userId, 'attempts', currentAttemptId);
             
             // 1. Ask for final Summary
             const summaryPrompt = `To koniec testu. Uczeń uzyskał wynik ${percentage}%. 
             Przeanalizuj całą naszą rozmowę i historię błędów. 
             Napisz końcowe podsumowanie dla ucznia (3-4 zdania): co poszło świetnie, a co wymaga powtórki.`;
             
             globalChatHistory.push({ role: "user", parts: [{ text: summaryPrompt }] });
             
             const payload = { 
                contents: globalChatHistory,
                // No system instruction needed here as it's already in history
             };
             const result = await makeApiCall(TEXT_API_URL, payload);
             let finalFeedback = "Dziękuję za rozwiązanie testu!";
             
             if (result && result.candidates && result.candidates[0].content) {
                 finalFeedback = result.candidates[0].content.parts[0].text;
             }
             
             // Display Final Feedback
             const finalScreen = document.getElementById('final-screen');
             const feedbackDiv = document.createElement('div');
             feedbackDiv.className = "p-6 bg-indigo-50 rounded-lg mt-6 text-left border border-indigo-100";
             feedbackDiv.innerHTML = `<h3 class="font-bold text-lg text-indigo-900 mb-2">Podsumowanie Nauczyciela:</h3><p class="text-indigo-800">${renderMarkdown(finalFeedback)}</p>`;
             finalScreen.insertBefore(feedbackDiv, finalScreen.lastElementChild);
             
             // 2. Final Update to Firestore
             await updateDoc(attemptRef, {
                 status: 'completed',
                 completedAt: new Date(),
                 totalScore: percentage,
                 finalFeedback: finalFeedback,
                 // Also save the full chat history for review if needed
                 fullChatHistory: JSON.stringify(globalChatHistory)
             });
        }


        // --- Gemini Teacher ---
        
        function getTaskContext(taskNumber) {
            const context = {
                instruction: document.getElementById(`instruction-${taskNumber}`).innerText.trim(),
                userAnswers: {},
                script: null,
                readingText: null
            };
            
            const taskContainer = document.getElementById(`task-${taskNumber}`);
            taskContainer.querySelectorAll('input[type="text"]').forEach(input => {
                if (!input.id.startsWith('gemini') && input.id !== 'edit-prompt-input') {
                    context.userAnswers[input.id] = input.value;
                }
            });
            taskContainer.querySelectorAll('input[type="radio"]:checked').forEach(input => {
                 context.userAnswers[input.name] = input.value;
            });

            if (taskNumber === 1) {
                context.script = audioScript;
            } else if (taskNumber === 7) {
                context.readingText = document.getElementById('reading-texts-7').innerText.trim();
            }

            return context;
        }

        function renderGeminiTeacherUI(taskNumber) {
             const teacherContainer = document.getElementById(`gemini-teacher-${taskNumber}`);
             // Only render if empty to preserve history visual within task if navigated back/forth (though nextTask currently moves forward)
             if(teacherContainer.innerHTML.trim() !== '') return;

             teacherContainer.innerHTML = `
                <p class="font-semibold text-indigo-800">Nauczyciel Gemini</p>
                <div id="gemini-chat-history-${taskNumber}" class="space-y-2"></div>
                <div id="gemini-suggestions-${taskNumber}" class="mt-4"></div>
                <div class="mt-4 flex items-center space-x-2">
                    <input type="text" id="gemini-chat-input-${taskNumber}" class="w-full" placeholder="Zadaj pytanie lub opisz problem...">
                    <button onclick="sendChatMessage(${taskNumber})" class="control-btn btn-primary">Wyślij</button>
                </div>
            `;
            document.getElementById(`gemini-chat-input-${taskNumber}`).addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    sendChatMessage(taskNumber);
                }
            });
            
            // Re-render recent visible history if we were to support going back, 
            // currently we just start fresh UI for the new task container
        }
        
        function renderMarkdown(text) {
             return text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/## (.*?)\n/g, '<h3>$1</h3>')
                .replace(/# (.*?)\n/g, '<h2>$1</h2>')
                .replace(/\n/g, '<br>');
        }

        async function getGeminiFeedback(taskNumber, incorrectDetails, fullContext = null, isFollowUp = false) {
            const teacherContainer = document.getElementById(`gemini-teacher-${taskNumber}`);
            teacherContainer.classList.remove('hidden');
            const historyContainer = document.getElementById(`gemini-chat-history-${taskNumber}`);
            
            // UI Loading Indicator
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'loader';
            historyContainer.appendChild(loadingDiv);
            
            // Determine the actual prompt to send
            let promptText = "";
            const totalErrors = incorrectDetails.length;
            const hasMoreErrors = totalErrors > 1;
            let navigationInstruction = "";
            
            if (hasMoreErrors) {
                navigationInstruction = `\nWAŻNE INSTRUKCJE NAWIGACYJNE: Uczeń ma jeszcze ${totalErrors - 1} innych błędów w tym zadaniu. Niezależnie od tego, co napiszesz, na samym końcu swojej wypowiedzi ZAWSZE dodaj opcję w nawiasach: [[Przejdź do kolejnego błędu]]. Jest to krytyczne, aby uczeń nie utknął.`;
            }

            if (isFollowUp) {
                 // The user already added their message to history in sendChatMessage
                 // We just need to append the system instruction as a "Developer Note" or assume Persona handles it.
                 // To force navigation buttons, we can append a system note.
                 globalChatHistory.push({ role: "user", parts: [{ text: `(System Note: Pamiętaj o instrukcjach nawigacyjnych: ${navigationInstruction})` }] }); 
            } else {
                 // New check triggered
                 let contextString = `Odpowiedzi ucznia w Zadaniu ${taskNumber}: ${JSON.stringify(fullContext.userAnswers)}\n`;
                 
                 if (incorrectDetails.length === 0) {
                     promptText = `Uczeń rozwiązał Zadanie ${taskNumber} bezbłędnie. Pogratuluj mu krótko.`;
                 } else {
                     promptText = `Uczeń popełnił błędy w Zadaniu ${taskNumber}: ${JSON.stringify(incorrectDetails)}.\n
                     Skup się teraz TYLKO na pierwszym błędzie z listy: "${incorrectDetails[0].question}". Wyjaśnij go, zadaj pytanie naprowadzające.
                     ${navigationInstruction}
                     Oprócz opcji przejścia, zaoferuj standardowe sugestie: [[Wyjaśnij mi tę zasadę]], [[Podaj inny przykład]].`;
                 }
                 globalChatHistory.push({ role: "user", parts: [{ text: promptText }] });
            }

            const payload = { 
                contents: globalChatHistory,
                // System instruction is already at index 0 of history
            };
            
            const result = await makeApiCall(TEXT_API_URL, payload);
            loadingDiv.remove();

            if (result && result.candidates && result.candidates[0].content) {
                let responseText = result.candidates[0].content.parts[0].text;
                
                // Add model response to history
                globalChatHistory.push({ role: "model", parts: [{ text: responseText }] });
                
                let suggestionsHtml = '';
                const suggestionRegex = /\[\[(.*?)\]\]/g;
                let match;
                while((match = suggestionRegex.exec(responseText)) !== null){
                    suggestionsHtml += `<button class="gemini-suggestion-btn" onclick="sendChatMessage(${taskNumber}, '${match[1]}')">${match[1]}</button>`;
                }
                responseText = responseText.replace(suggestionRegex, '').trim();

                const bubble = document.createElement('div');
                bubble.className = 'gemini-teacher-bubble';
                bubble.innerHTML = `<strong>Nauczyciel:</strong> ${renderMarkdown(responseText)}`;
                historyContainer.appendChild(bubble);
                document.getElementById(`gemini-suggestions-${taskNumber}`).innerHTML = suggestionsHtml;
                historyContainer.scrollTop = historyContainer.scrollHeight;
            } else {
                historyContainer.innerHTML += `<p class="text-red-500">Wystąpił błąd podczas generowania podpowiedzi.</p>`;
            }
        }
        
        window.sendChatMessage = function(taskNumber, predefinedText = null) {
            const input = document.getElementById(`gemini-chat-input-${taskNumber}`);
            const userText = predefinedText || input.value;
            if (!userText.trim()) return;
            
            const historyContainer = document.getElementById(`gemini-chat-history-${taskNumber}`);
            const userBubble = document.createElement('div');
            userBubble.className = 'gemini-teacher-bubble text-right bg-blue-50';
            userBubble.innerHTML = `<strong>Ty:</strong> ${userText}`;
            historyContainer.appendChild(userBubble);
            
            // Add user message to history
            globalChatHistory.push({ role: "user", parts: [{ text: userText }] });
            
            // We need to pass incorrectDetails if we are in a correction loop, 
            // but getting it from UI is hard.
            // Simplified: If user replies, we assume we are just continuing the thread. 
            // The "incorrectDetails" logic is handled by the model remembering context.
            // UNLESS it's the specific navigation command.
            
            if (predefinedText === 'Przejdź do kolejnego błędu') {
                // For this to work perfectly, we'd need to shift the incorrectDetails array.
                // But since we are using a continuous chat, we can just tell Gemini:
                // "Ok, move to the next error."
                // And Gemini (if smart enough) will look at the previous list provided.
                // To be safe, we can re-trigger checkResults logic or just rely on context.
                // For simplicity here, relying on context + prompt instruction.
            }
            
            // Trigger response
            getGeminiFeedback(taskNumber, [], null, true);
            
            if(!predefinedText) input.value = '';
            historyContainer.scrollTop = historyContainer.scrollHeight;
        }

        function resetGeminiTeacher(taskNumber) {
             const teacherContainer = document.getElementById(`gemini-teacher-${taskNumber}`);
             if (teacherContainer) {
                 teacherContainer.innerHTML = '';
                 teacherContainer.classList.add('hidden');
                 // Do NOT clear globalChatHistory here to maintain context
             }
        }
        
        // --- Utils ---
        async function makeApiCall(url, payload) {
            let attempts = 0, delay = 1000;
            const finalUrl = `${url}?key=${API_KEY}`;
            while (attempts < 5) {
                try {
                    const response = await fetch(finalUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    
                    if (response.ok) return await response.json();
                    
                    // Handle specific errors that might be transient (401, 403, 429, 5xx)
                    // We throw here to trigger the catch block's retry logic
                    throw new Error(`HTTP error! status: ${response.status}`);
                    
                } catch (error) {
                    attempts++;
                    // Only log if we've exhausted all retries to avoid console noise for transient errors
                    if (attempts >= 5) {
                         console.error(`API call failed after ${attempts} attempts:`, error);
                         return null;
                    }
                    // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
            }
            return null;
        }

        function base64ToArrayBuffer(base64) {
            const binaryString = window.atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        }

        function pcmToWav(pcmData, sampleRate) {
            const numChannels = 1;
            const bytesPerSample = 2; // 16-bit PCM
            const blockAlign = numChannels * bytesPerSample;
            const byteRate = sampleRate * blockAlign;
            const dataSize = pcmData.length * bytesPerSample;
            const buffer = new ArrayBuffer(44 + dataSize);
            const view = new DataView(buffer);
            view.setUint32(0, 0x52494646, false); 
            view.setUint32(4, 36 + dataSize, true);
            view.setUint32(8, 0x57415645, false);
            view.setUint32(12, 0x666d7420, false);
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bytesPerSample * 8, true);
            view.setUint32(36, 0x64617461, false);
            view.setUint32(40, dataSize, true);
            let offset = 44;
            for (let i = 0; i < pcmData.length; i++, offset += 2) {
                view.setInt16(offset, pcmData[i], true);
            }
            return new Blob([view], { type: 'audio/wav' });
        }

    </script>

</body>

</html>
</FULL APP WORKING EXAMPLE>

