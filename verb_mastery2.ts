import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, serverTimestamp, query, orderBy, writeBatch } from 'firebase/firestore';

// --- GLOBAL VARIABLES & CONFIG ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Spaced Repetition Intervals (in days) for confidence levels 1 through 7
const confidenceIntervals = [1, 3, 7, 14, 30, 60, 180];

// --- MAIN APP COMPONENT ---
function App() {
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userProgress, setUserProgress] = useState({});
  const [userMistakes, setUserMistakes] = useState([]);
  const [irregularVerbs, setIrregularVerbs] = useState([]);
  const [userLevel, setUserLevel] = useState('B1');
  const [userKeywords, setUserKeywords] = useState([]);
  const [screen, setScreen] = useState('dashboard'); // dashboard, practice, progress, mistake_review, mistake_history, settings
  const [practiceVerb, setPracticeVerb] = useState(null);
  const [activeMistakes, setActiveMistakes] = useState([]);

  // Initialize Firebase
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const auth = getAuth(app);
      setDb(firestore);
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          try {
            const cred = initialAuthToken ? await signInWithCustomToken(auth, initialAuthToken) : await signInAnonymously(auth);
            setUserId(cred.user.uid);
          } catch (error) {
            console.error("Auth Error:", error);
            setUserId('fallback_user_' + Date.now());
          }
        }
        setIsAuthReady(true);
      });
    } catch (error) { console.error("Firebase Init Error:", error); }
  }, []);

  // Load irregular verbs from public collection
  useEffect(() => {
    if (!db || !isAuthReady) return;
    const verbsCollectionRef = collection(db, `artifacts/${appId}/public/data/irregularVerbs`);
    const unsubscribe = onSnapshot(verbsCollectionRef, (snapshot) => {
      const verbs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const formattedVerbs = verbs.map(v => [v.infinitive, v.pastSimple, v.pastParticiple, v.polish]);
      setIrregularVerbs(formattedVerbs);
    }, (error) => console.error("Error fetching irregular verbs:", error));
    return () => unsubscribe();
  }, [db, isAuthReady]);

  // Load user progress for verbs
  useEffect(() => {
    if (!isAuthReady || !db || !userId || irregularVerbs.length === 0) return;
    const userProgressDocRef = doc(db, `artifacts/${appId}/users/${userId}/verbProgress`, 'progress');
    const unsubscribe = onSnapshot(userProgressDocRef, (docSnap) => {
      const existingProgress = docSnap.exists() ? docSnap.data() : {};
      let updatedProgress = { ...existingProgress };
      let needsUpdate = false;
      irregularVerbs.forEach(verb => {
        if (!existingProgress[verb[0]]) {
          updatedProgress[verb[0]] = { level: 'New', correct: 0, incorrect: 0, lastPracticed: null };
          needsUpdate = true;
        }
      });
      setUserProgress(updatedProgress);
      if (needsUpdate) setDoc(userProgressDocRef, updatedProgress, { merge: true });
    });
    return () => unsubscribe();
  }, [isAuthReady, db, userId, irregularVerbs]);
  
  // Load user profile for level and keywords
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;
    const profileDocRef = doc(db, `artifacts/${appId}/users/${userId}/profile`, 'settings');
    const unsubscribe = onSnapshot(profileDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.level) {
                setUserLevel(data.level);
            }
            if (data.keywords && Array.isArray(data.keywords)) {
                setUserKeywords(data.keywords);
            }
        }
    });
    return () => unsubscribe();
  }, [isAuthReady, db, userId]);

  // Load ALL user mistakes for history and derive active review queue
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;
    const mistakesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/mistakes`);
    const q = query(mistakesCollectionRef, orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const allMistakes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setUserMistakes(allMistakes);
        
        const now = new Date();
        const active = allMistakes.filter(m => m.nextReviewAt && m.nextReviewAt.toDate() <= now);
        setActiveMistakes(active);
    });
    return () => unsubscribe();
  }, [isAuthReady, db, userId]);

  const updateUserProfile = async (updates) => {
    if (!db || !userId) return;
    await setDoc(doc(db, `artifacts/${appId}/users/${userId}/profile`, 'settings'), updates, { merge: true });
  };

  const updateUserLevel = async (newLevel) => {
    setUserLevel(newLevel);
    await updateUserProfile({ level: newLevel });
  };

  const updateUserKeywords = async (newKeywords) => {
    setUserKeywords(newKeywords);
    await updateUserProfile({ keywords: newKeywords });
  };

  const saveUserMistake = async (verb, sentence, feedback, existingTags = null) => {
    if (!db || !userId) return;
    let tags = existingTags;
    // Only call the AI for tags if they weren't provided
    if (tags === null) {
        const taggingPrompt = `A student made a mistake. Sentence: "${sentence}". Feedback: "${feedback}". Analyze and categorize it. Choose from: "verb_form", "grammar", "vocabulary", "word_order", "style", "punctuation". Respond ONLY with JSON: {"tags": ["tag1", "tag2", ...]}`;
        try {
            const result = await callGemini(taggingPrompt, true);
            tags = result.tags || ['untagged'];
        } catch (e) {
            console.error("Could not generate tags for mistake", e);
            tags = ['untagged'];
        }
    }
    await addDoc(collection(db, `artifacts/${appId}/users/${userId}/mistakes`), {
        verb, sentence, feedback, tags,
        timestamp: serverTimestamp(),
        confidenceLevel: 0,
        nextReviewAt: new Date()
    });
  };

  const updateMistakeStatus = async (mistakeId, wasCorrect) => {
    if (!db || !userId) return;
    const mistakeRef = doc(db, `artifacts/${appId}/users/${userId}/mistakes`, mistakeId);
    const mistake = userMistakes.find(m => m.id === mistakeId);
    if (!mistake) return;
    let newConfidence = mistake.confidenceLevel || 0;
    if (wasCorrect) {
        newConfidence = Math.min(newConfidence + 1, confidenceIntervals.length);
    } else {
        newConfidence = Math.max(newConfidence - 1, 0);
    }
    
    const intervalDays = confidenceIntervals[newConfidence - 1] || 1;
    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + intervalDays);

    await setDoc(mistakeRef, {
        confidenceLevel: newConfidence,
        nextReviewAt: nextReviewDate
    }, { merge: true });
  };
  
  const resetMistake = async (mistakeId) => {
    if (!db || !userId) return;
    const mistakeRef = doc(db, `artifacts/${appId}/users/${userId}/mistakes`, mistakeId);
    await setDoc(mistakeRef, {
        confidenceLevel: 0,
        nextReviewAt: new Date()
    }, { merge: true });
    console.log("✅ Mistake has been added back to your review queue.");
  };

  const updateVerbProgress = async (verb, isCorrect, userSentence = '', feedback = '') => {
    const verbName = verb[0];
    const current = userProgress[verbName] || { level: 'New', correct: 0, incorrect: 0 };
    let newLevel = current.level;
    const newCorrect = isCorrect ? current.correct + 1 : current.correct;
    const newIncorrect = !isCorrect ? current.incorrect + 1 : current.incorrect;
    if (isCorrect) {
      if (current.level === 'New') newLevel = 'Learning';
      else if (current.level === 'Learning' && newCorrect >= 4) newLevel = 'Mastered';
    } else {
      if (current.level === 'Mastered') newLevel = 'Learning';
      await saveUserMistake(verb[0], userSentence, feedback);
    }
    const updatedProgress = { ...userProgress, [verbName]: { ...current, level: newLevel, correct: newCorrect, incorrect: newIncorrect, lastPracticed: new Date().toISOString() } };
    setUserProgress(updatedProgress);
    await setDoc(doc(db, `artifacts/${appId}/users/${userId}/verbProgress`, 'progress'), updatedProgress, { merge: true });
  };

  const addNewVerb = async (verbData) => {
    if (!db) return;
    await addDoc(collection(db, `artifacts/${appId}/public/data/irregularVerbs`), verbData);
  };

  const renderScreen = () => {
    if (irregularVerbs.length === 0 && isAuthReady) {
        return (
            <div className="text-center">
                <h2 className="text-xl font-semibold mb-4">Welcome!</h2>
                <p className="text-gray-600 mb-4">No verbs in the database yet. Be the first to add one!</p>
                <AddVerbForm 
                    onSave={addNewVerb} 
                    onCancel={() => {}} 
                    userKeywords={userKeywords}     // <-- FIX #1: Pass missing prop
                    irregularVerbs={irregularVerbs} // <-- FIX #2: Pass missing prop
                />
            </div>
        );
    }
    switch (screen) {
      case 'practice':
        return <PracticeScreen verb={practiceVerb} onFinish={updateVerbProgress} backToDash={() => setScreen('dashboard')} userLevel={userLevel} userKeywords={userKeywords} />;
      case 'progress':
        return <ProgressScreen userProgress={userProgress} irregularVerbs={irregularVerbs} backToDash={() => setScreen('dashboard')} onAddVerb={addNewVerb} userKeywords={userKeywords} db={db} appId={appId} />;
      case 'mistake_review':
        return <MistakeReviewScreen mistakesToReview={activeMistakes} onMistakeReviewed={updateMistakeStatus} backToDash={() => setScreen('dashboard')} userLevel={userLevel} onNewMistake={saveUserMistake} userKeywords={userKeywords} />;
      case 'mistake_history':
        return <MistakeHistoryScreen allMistakes={userMistakes} onResetMistake={resetMistake} backToDash={() => setScreen('dashboard')} />;
      case 'settings':
        return <SettingsScreen userLevel={userLevel} userKeywords={userKeywords} onUpdateLevel={updateUserLevel} onUpdateKeywords={updateUserKeywords} backToDash={() => setScreen('dashboard')} />;
      default:
        return <Dashboard userProgress={userProgress} irregularVerbs={irregularVerbs} activeMistakeCount={activeMistakes.length} onPractice={(verb) => { setPracticeVerb(verb); setScreen('practice'); }} showProgress={() => setScreen('progress')} onStartMistakeReview={() => setScreen('mistake_review')} showHistory={() => setScreen('mistake_history')} showSettings={() => setScreen('settings')} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-800"><div className="container mx-auto p-4 max-w-4xl"><header className="text-center my-6"><h1 className="text-4xl font-bold text-blue-600">Irregular Verbs Mastery</h1><p className="text-lg text-gray-600">Personalized practice for Polish learners</p></header><main className="bg-white p-6 rounded-xl shadow-lg">{isAuthReady ? renderScreen() : <p className="text-center">Loading your learning journey...</p>}</main></div></div>
  );
}

// --- DASHBOARD COMPONENT ---
function Dashboard({ userProgress, irregularVerbs, activeMistakeCount, onPractice, showProgress, onStartMistakeReview, showHistory, showSettings }) {
    const stats = useMemo(() => {
        const progressValues = Object.values(userProgress);
        if (progressValues.length === 0 || irregularVerbs.length === 0) return { mastered: 0, learning: 0, new: 0, total: 0 };
        const mastered = progressValues.filter(v => v.level === 'Mastered').length;
        const learning = progressValues.filter(v => v.level === 'Learning').length;
        const total = irregularVerbs.length;
        const newCount = total - mastered - learning;
        return { mastered, learning, new: newCount, total };
    }, [userProgress, irregularVerbs]);

    const verbOfTheDay = useMemo(() => {
        if (irregularVerbs.length === 0) return null;
        const notMastered = irregularVerbs.filter(v => userProgress[v[0]]?.level !== 'Mastered');
        if (notMastered.length === 0) return irregularVerbs[0];
        return notMastered[new Date().getDate() % notMastered.length];
    }, [userProgress, irregularVerbs]);

    const practiceSuggestions = useMemo(() => {
        if (irregularVerbs.length === 0) return [];
        const progressValues = Object.entries(userProgress);
        const learning = progressValues.filter(([,p]) => p.level === 'Learning');
        const newVerbs = progressValues.filter(([,p]) => p.level === 'New');
        return [...learning, ...newVerbs].sort(([,a], [,b]) => (b.incorrect - a.incorrect)).slice(0, 5).map(([verbName]) => irregularVerbs.find(v => v[0] === verbName)).filter(Boolean);
    }, [userProgress, irregularVerbs]);

    if (!verbOfTheDay) return <p>Loading dashboard...</p>;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <button onClick={onStartMistakeReview} disabled={activeMistakeCount === 0} className="bg-red-600 text-white py-3 px-6 rounded-lg hover:bg-red-700 transition font-bold text-lg disabled:bg-gray-400 disabled:cursor-not-allowed">Review {activeMistakeCount} Mistakes</button>
                <button onClick={showSettings} className="bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition">Settings</button>
            </div>
            <h2 className="text-2xl font-bold mb-4">Your Dashboard</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center mb-6">
                <div className="bg-green-100 p-4 rounded-lg"><p className="text-3xl font-bold text-green-700">{stats.mastered}</p><p className="text-green-600">Mastered</p></div>
                <div className="bg-yellow-100 p-4 rounded-lg"><p className="text-3xl font-bold text-yellow-700">{stats.learning}</p><p className="text-yellow-600">Learning</p></div>
                <div className="bg-blue-100 p-4 rounded-lg"><p className="text-3xl font-bold text-blue-700">{stats.new}</p><p className="text-blue-600">New</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-4 rounded-lg"><h3 className="text-xl font-semibold mb-3">Verb of the Day</h3><VerbCard verb={verbOfTheDay} progress={userProgress[verbOfTheDay[0]]} /><button onClick={() => onPractice(verbOfTheDay)} className="mt-3 w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition">Practice Now</button></div>
                <div className="bg-gray-50 p-4 rounded-lg"><h3 className="text-xl font-semibold mb-3">Practice Suggestions</h3>
                    {practiceSuggestions.length > 0 ? (<ul className="space-y-2">{practiceSuggestions.map(verb => (<li key={verb[0]} className="flex justify-between items-center bg-white p-2 rounded-md shadow-sm"><span>{verb[0]} <span className="text-sm text-gray-500">({verb[3]})</span></span><button onClick={() => onPractice(verb)} className="bg-green-500 text-white px-3 py-1 text-sm rounded-md hover:bg-green-600">Practice</button></li>))}</ul>) : <p className="text-gray-500">You've mastered all verbs!</p>}
                </div>
            </div>
            <button onClick={showProgress} className="mt-6 w-full bg-gray-700 text-white py-2 rounded-lg hover:bg-gray-800 transition">View Full Progress & Add Verbs</button>
            <button onClick={showHistory} className="mt-4 w-full bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 transition">View All Mistake History</button>
        </div>
    );
}

// --- SETTINGS SCREEN ---
function SettingsScreen({ userLevel, userKeywords, onUpdateLevel, onUpdateKeywords, backToDash }) {
    const [newKeyword, setNewKeyword] = useState('');

    const addKeyword = () => {
        if (newKeyword.trim() && !userKeywords.includes(newKeyword.trim())) {
            onUpdateKeywords([...userKeywords, newKeyword.trim()]);
            setNewKeyword('');
        }
    };

    const removeKeyword = (keyword) => {
        onUpdateKeywords(userKeywords.filter(k => k !== keyword));
    };

    return (
        <div>
            <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
            <h2 className="text-2xl font-bold mb-6">Settings</h2>
            
            {/* Level Selection */}
            <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <h3 className="text-lg font-semibold mb-3">My Proficiency Level</h3>
                <div className="flex items-center gap-2">
                    <label htmlFor="level-select" className="text-sm font-medium text-gray-700">Current Level:</label>
                    <select id="level-select" value={userLevel} onChange={(e) => onUpdateLevel(e.target.value)} className="rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
                        <option value="A1">A1 - Beginner</option>
                        <option value="A2">A2 - Elementary</option>
                        <option value="B1">B1 - Intermediate</option>
                        <option value="B2">B2 - Upper Intermediate</option>
                        <option value="C1">C1 - Advanced</option>
                    </select>
                </div>
            </div>

            {/* Keywords Management */}
            <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-3">Personal Interests & Keywords</h3>
                <p className="text-sm text-gray-600 mb-4">Add keywords about your interests to get more personalized exercises and hints.</p>
                
                {/* Add New Keyword */}
                <div className="flex gap-2 mb-4">
                    <input 
                        type="text" 
                        value={newKeyword} 
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && addKeyword()}
                        placeholder="e.g., travel, cooking, sports..."
                        className="flex-1 p-2 border rounded-lg"
                    />
                    <button 
                        onClick={addKeyword}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                    >
                        Add
                    </button>
                </div>

                {/* Current Keywords */}
                <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">Your Keywords:</h4>
                    {userKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {userKeywords.map(keyword => (
                                <span key={keyword} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                                    {keyword}
                                    <button 
                                        onClick={() => removeKeyword(keyword)}
                                        className="text-blue-600 hover:text-blue-800 font-bold"
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-sm">No keywords added yet. Add some to personalize your learning experience!</p>
                    )}
                </div>
            </div>
        </div>
    );
}

// --- MISTAKE REVIEW SCREEN ---
function MistakeReviewScreen({ mistakesToReview, onMistakeReviewed, backToDash, userLevel, onNewMistake, userKeywords }) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAssessmentDone, setIsAssessmentDone] = useState(false);
    const [practiceStep, setPracticeStep] = useState('mcq');
    const [exercise, setExercise] = useState(null);
    const [userInput, setUserInput] = useState('');
    const [feedback, setFeedback] = useState({ text: '', type: '' });
    const [isLoading, setIsLoading] = useState(false);
    
    const currentMistake = mistakesToReview[currentIndex];

    const getLanguageInstruction = (level) => {
        if (level === 'A1') return "Explain everything in Polish. Use simple Polish. The student is a beginner.";
        if (level === 'A2') return "Explain in simple English, but provide a Polish translation for key terms.";
        return `Explain in English, adjusting the vocabulary and complexity for a ${level} level student.`;
    };

    const generateExercise = async (step) => {
        setIsLoading(true);
        setExercise(null);
        setFeedback({ text: '', type: '' });
        setUserInput('');
        
        let prompt;
        const langInstruction = getLanguageInstruction(userLevel);
        const keywordsText = userKeywords.length > 0 ? `Student's interests: ${userKeywords.join(', ')}.` : '';
        const baseInfo = `Student Level: ${userLevel}. ${keywordsText} Original mistake: "${currentMistake.sentence}" (verb: ${currentMistake.verb}). Original feedback: "${currentMistake.feedback}". ${langInstruction}`;
        
        switch (step) {
            case 'mcq':
                prompt = `${baseInfo} Create a multiple-choice question to test the core concept. Respond ONLY with JSON: {"type": "mcq", "question": "...", "options": ["...", "...", "..."], "answer": "..."}`;
                break;
            case 'fill_gap':
                prompt = `${baseInfo} Create a fill-in-the-gap exercise. Respond ONLY with JSON: {"type": "fill", "question": "...", "answer": "..."}`;
                break;
            case 'translate_paraphrase':
                if (['A1', 'A2'].includes(userLevel)) {
                    prompt = `${baseInfo} Create a simple Polish sentence for the user to translate into English to practice the concept. Respond ONLY with JSON: {"type": "translate", "question": "Przetłumacz: ...", "answer": "..."}`;
                } else {
                    prompt = `${baseInfo} Ask the user to paraphrase a simple sentence to practice the concept. Respond ONLY with JSON: {"type": "paraphrase", "question": "Rewrite this sentence: ...", "answer": "..."}`;
                }
                break;
            default: setIsLoading(false); return;
        }
        try {
            const result = await callGemini(prompt, true);
            setExercise(result);
        } catch (e) {
            setFeedback({ text: "Could not generate exercise. Moving to next mistake.", type: 'incorrect' });
            setTimeout(moveToNextMistake, 2000);
        }
        setIsLoading(false);
    };

    const handleAssessment = async () => {
        if (!userInput.trim()) return;
        
        // Check if original mistake was just a single word (incomplete sentence)
        const originalWordCount = currentMistake.sentence.trim().split(/\s+/).length;
        
        setIsLoading(true);
        
        const keywordsText = userKeywords.length > 0 ? `Student's interests: ${userKeywords.join(', ')}.` : '';
        
        let newPrompt;
        if (originalWordCount < 3) {
            // Handle incomplete original "sentences" (like single words)
            newPrompt = `You are an expert ESL tutor. A student at proficiency level ${userLevel} previously wrote just "${currentMistake.sentence}" which was incomplete (not a full sentence). ${keywordsText}
            Now they wrote a complete sentence: "${userInput}"
            Check if this new sentence correctly uses the verb "${currentMistake.verb}" and is grammatically correct.
            ${getLanguageInstruction(userLevel)}
            Respond ONLY with a single JSON object:
            {
              "is_correct": boolean,
              "feedback": "Feedback about their new complete sentence.",
              "tags": ["grammar", "verb_form"]
            }`;
        } else {
            // ENHANCED: Multi-layered mistake analysis for sophisticated pedagogical feedback
            newPrompt = `You are an expert ESL tutor. A student at proficiency level ${userLevel} is reviewing a mistake. ${keywordsText}
            
            CONTEXT: The original mistake was about the verb "${currentMistake.verb}". The student wrote: "${currentMistake.sentence}"
            
            STUDENT'S CORRECTION ATTEMPT: "${userInput}"
            
            Perform MULTI-LAYERED ANALYSIS:
            1. TARGET SKILL: Did they use the verb "${currentMistake.verb}" correctly this time? (This was the original learning target)
            2. OTHER ERRORS: Are there any NEW grammar, vocabulary, or syntax errors unrelated to the target verb?
            3. OVERALL ASSESSMENT: Is the sentence completely correct?
            
            ${getLanguageInstruction(userLevel)}
            
            Respond ONLY with this JSON structure:
            {
              "target_verb_correct": boolean,
              "overall_correct": boolean, 
              "new_errors": [{"type": "vocabulary|grammar|syntax", "description": "specific issue"}],
              "feedback": "Multi-layered feedback addressing both target skill progress and any new issues",
              "confidence_action": "increase|decrease|maintain",
              "tags": ["tag1", "tag2"]
            }`;
        }
        
        try {
            const result = await callGemini(newPrompt, true);
            
            // ENHANCED: Handle multi-layered response
            if (originalWordCount >= 3 && result.target_verb_correct !== undefined) {
                // New sophisticated handling
                const wasTargetVerbCorrect = result.target_verb_correct;
                const wasOverallCorrect = result.overall_correct;
                
                // Update the ORIGINAL mistake confidence based on target verb performance
                onMistakeReviewed(currentMistake.id, wasTargetVerbCorrect);
                
                setFeedback({ 
                    text: result.feedback, 
                    type: wasOverallCorrect ? 'correct' : (wasTargetVerbCorrect ? 'warning' : 'incorrect')
                });
                
                // If there are NEW errors (beyond the target verb), log them as separate mistakes
                if (result.new_errors && result.new_errors.length > 0 && !wasOverallCorrect) {
                    result.new_errors.forEach(error => {
                        onNewMistake(
                            currentMistake.verb, 
                            userInput, 
                            `New ${error.type} error: ${error.description}`, 
                            [error.type]
                        );
                    });
                }
                
                if (wasOverallCorrect) {
                    // Perfect! Move to next mistake
                    setTimeout(moveToNextMistake, 2500);
                } else if (wasTargetVerbCorrect) {
                    // Target verb good, but other issues - move on but they learned the main skill
                    setTimeout(moveToNextMistake, 3500); // Slightly longer to read feedback
                } else {
                    // Target verb still wrong - continue with practice exercises
                    setIsAssessmentDone(true);
                    generateExercise('mcq');
                }
            } else {
                // Fallback to original simple handling
                const isCorrect = result.is_correct || result.overall_correct;
                onMistakeReviewed(currentMistake.id, isCorrect);
                setFeedback({ text: result.feedback, type: isCorrect ? 'correct' : 'incorrect' });
                
                if (!isCorrect) {
                    onNewMistake(
                        currentMistake.verb, 
                        userInput, 
                        `Correction attempt for '${currentMistake.sentence}': ${result.feedback}`, 
                        result.tags || ['grammar']
                    );
                    setIsAssessmentDone(true);
                    generateExercise('mcq');
                } else {
                    setTimeout(moveToNextMistake, 2500);
                }
            }
        } catch (e) {
            console.error("Error during mistake assessment:", e);
            setFeedback({ text: "Error checking answer. There might be an authentication issue. Please try again.", type: 'incorrect' });
        }
        setIsLoading(false);
    };

    const handlePracticeAnswer = () => {
        const isCorrect = userInput.trim().toLowerCase() === exercise.answer.toLowerCase();
        setFeedback({ text: isCorrect ? 'Good job!' : `The answer is: ${exercise.answer}`, type: isCorrect ? 'correct' : 'incorrect' });
        
        setTimeout(() => {
            const steps = ['mcq', 'fill_gap', 'translate_paraphrase'];
            const currentStepIndex = steps.indexOf(practiceStep);
            if (currentStepIndex >= steps.length - 1) {
                moveToNextMistake();
            } else {
                const nextStep = steps[currentStepIndex + 1];
                setPracticeStep(nextStep);
                generateExercise(nextStep);
            }
        }, 2000);
    };

    const moveToNextMistake = () => {
        if (currentIndex + 1 >= mistakesToReview.length) {
            backToDash();
        } else {
            setCurrentIndex(currentIndex + 1);
        }
    };
    
    useEffect(() => {
        if (currentMistake) {
          setIsAssessmentDone(false);
          setExercise(null);
          setUserInput('');
          setFeedback({ text: '', type: '' });
        }
    }, [currentIndex]);

    if (!currentMistake) {
        return <div className="text-center"><p className="text-xl font-semibold">No mistakes to review today. Great job!</p><button onClick={backToDash} className="mt-4 text-blue-600 hover:underline">Back to Dashboard</button></div>;
    }

    return (
        <div>
            <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
            <h2 className="text-2xl font-bold mb-4 text-center">Mistake Review ({currentIndex + 1} / {mistakesToReview.length})</h2>
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-600">You previously wrote:</p>
                <p className="font-mono text-red-800">"{currentMistake.sentence}"</p>
            </div>
            
            {!isAssessmentDone ? (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-center mb-2">Assessment: Correct Your Sentence</h3>
                    <p className="text-center text-gray-600 mb-3">Try to fix your original sentence below.</p>
                    <textarea value={userInput} onChange={e => setUserInput(e.target.value)} className="w-full p-2 border-2 rounded-lg" rows="3" placeholder="Rewrite the sentence correctly here..."/>
                    <button onClick={handleAssessment} disabled={isLoading || !userInput} className="mt-4 w-full bg-green-600 text-white py-2 rounded-lg disabled:bg-gray-400">Submit Correction</button>
                </div>
            ) : (
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-center mb-3">Practice: {practiceStep}</h3>
                    {isLoading ? <p className="text-center">Loading practice...</p> : exercise ? (
                        <div>
                            <p className="text-center text-lg mb-4" dangerouslySetInnerHTML={{ __html: exercise.question.replace(/_+/g, '<strong class="text-blue-600">___</strong>') }}></p>
                            {exercise.type === 'mcq' && (
                                <div className="flex flex-col gap-2">{exercise.options.map(opt => <button key={opt} onClick={() => setUserInput(opt)} className={`p-2 border rounded-lg ${userInput === opt ? 'bg-blue-600 text-white' : 'bg-white'}`}>{opt}</button>)}</div>
                            )}
                            {['fill', 'translate', 'paraphrase'].includes(exercise.type) && (
                                <input type="text" value={userInput} onChange={e => setUserInput(e.target.value)} className="w-full p-2 border-2 rounded-lg" placeholder="Type your answer here"/>
                            )}
                            <button onClick={handlePracticeAnswer} disabled={!userInput} className="mt-4 w-full bg-green-600 text-white py-2 rounded-lg disabled:bg-gray-400">Check Practice</button>
                        </div>
                    ) : <p className="text-center text-red-500">Could not load practice exercise.</p>}
                </div>
            )}
            {feedback.text && (<div className={`mt-4 p-3 rounded-lg text-center font-medium ${feedback.type === 'correct' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{feedback.text}</div>)}
        </div>
    );
}

// --- MISTAKE HISTORY SCREEN ---
function MistakeHistoryScreen({ allMistakes, onResetMistake, backToDash }) {
    const getConfidenceColor = (level) => {
        if (level >= 5) return 'text-green-600';
        if (level >= 2) return 'text-yellow-600';
        return 'text-red-600';
    };

    return (
        <div>
            <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
            <h2 className="text-2xl font-bold mb-4">All Mistake History</h2>
            <div className="space-y-3">
                {allMistakes.length > 0 ? allMistakes.map(mistake => (
                    <div key={mistake.id} className="p-4 bg-white rounded-lg shadow-sm border">
                        <p className="font-mono text-gray-800">"{mistake.sentence}"</p>
                        <p className="text-sm text-gray-500 mt-2">Verb: {mistake.verb}</p>
                        <div className="flex justify-between items-center mt-3">
                            <div>
                                <p className={`text-sm font-semibold ${getConfidenceColor(mistake.confidenceLevel)}`}>
                                    Confidence: {mistake.confidenceLevel || 0} / {confidenceIntervals.length}
                                </p>
                                <p className="text-xs text-gray-500">
                                    Next Review: {mistake.nextReviewAt ? mistake.nextReviewAt.toDate().toLocaleDateString() : 'N/A'}
                                </p>
                            </div>
                            <button 
                                onClick={() => onResetMistake(mistake.id)}
                                className="bg-gray-200 text-gray-800 px-3 py-1 text-sm rounded-md hover:bg-gray-300"
                            >
                                Review Again
                            </button>
                        </div>
                    </div>
                )) : <p>No mistakes recorded yet. Keep practicing!</p>}
            </div>
        </div>
    );
}

// --- ENHANCED PRACTICE SCREEN WITH SCAFFOLDING ---
function PracticeScreen({ verb, onFinish, backToDash, userLevel, userKeywords }) {
    const [userInput, setUserInput] = useState('');
    const [feedback, setFeedback] = useState({ text: '', type: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [showForms, setShowForms] = useState(false);
    const [exercise, setExercise] = useState(null);
    const [hint, setHint] = useState('');
    const [showHint, setShowHint] = useState(false);
    const [needsImprovement, setNeedsImprovement] = useState(false);

    const verbToPractice = verb[1]; // Past Simple
    const keywordsText = userKeywords.length > 0 ? userKeywords.join(', ') : 'general topics';

    const getLanguageInstruction = (level) => {
        if (level === 'A1') return "Provide feedback in simple Polish.";
        if (level === 'A2') return "Provide feedback in simple English with Polish translations for key words.";
        return `Provide feedback in English suitable for a ${level} learner.`;
    };

    // Generate fill-in-the-gap exercise for A1 users
    const generateExercise = async () => {
        setIsLoading(true);
        const prompt = `An A1 level student is practicing the verb '${verb[0]}'. Create a simple fill-in-the-gap sentence exercise using its Past Simple form, '${verb[1]}'. The sentence MUST include a clear time indicator (yesterday, last week, ago, etc.) to show it's past tense. Respond ONLY with JSON: {"question": "Yesterday, I ___ a cat.", "answer": "saw", "explanation": "The verb 'see' changes to 'saw' in past simple because it's an irregular verb."}`;
        
        try {
            const result = await callGemini(prompt, true);
            setExercise(result);
        } catch (e) {
            setFeedback({ text: "Could not generate exercise. Please try the open practice instead.", type: 'incorrect' });
        }
        setIsLoading(false);
    };

    // Get hint for A2 users
    const getHint = async () => {
        setIsLoading(true);
        const prompt = `An A2 level student interested in '${keywordsText}' needs a hint for a sentence with the verb '${verb[1]}'. Provide a simple sentence starter. Respond ONLY with JSON: {"hint": "Yesterday, my friend..."}`;
        
        try {
            const result = await callGemini(prompt, true);
            setHint(result.hint);
            setShowHint(true);
        } catch (e) {
            setHint("Yesterday, I...");
            setShowHint(true);
        }
        setIsLoading(false);
    };

    // Initialize exercise for A1 users
    useEffect(() => {
        if (userLevel === 'A1') {
            generateExercise();
        }
    }, [verb, userLevel]);

    const handleA1Submit = () => {
        if (!userInput.trim()) return;
        
        const isCorrect = userInput.trim().toLowerCase() === exercise.answer.toLowerCase();
        
        if (isCorrect) {
            setFeedback({ text: 'Excellent! You got it right!', type: 'correct' });
            setTimeout(() => { onFinish(verb, true); backToDash(); }, 2500);
        } else {
            // THE FIX: Reconstruct the full sentence with the user's mistake
            const fullMistakeSentence = exercise.question.replace(/_+/g, userInput.trim());
            const helpfulFeedback = exercise.explanation 
                ? `${exercise.explanation} The correct answer is: ${exercise.answer}.`
                : `The correct answer is: ${exercise.answer}. Try again!`;
                
            setFeedback({ text: helpfulFeedback, type: 'incorrect' });
            
            // NOW, we pass the FULL MISTAKE SENTENCE to onFinish
            onFinish(
                verb, 
                false, 
                fullMistakeSentence, // e.g., "She sleep a dog in the park."
                `Fill-in-the-gap: Expected '${exercise.answer}' but got '${userInput}'`
            );
        }
    };

    const handleSentenceSubmit = async () => {
        if (!userInput.trim()) return;
        
        // Validate input - should be a sentence, not just a single word
        const wordCount = userInput.trim().split(/\s+/).length;
        if (wordCount < 3) {
            setFeedback({ 
                text: userLevel === 'A1' ? 'Napisz pełne zdanie (przynajmniej 3 słowa).' : 'Please write a complete sentence (at least 3 words).', 
                type: 'warning' 
            });
            return;
        }
        
        setIsLoading(true);
        setFeedback({text: '', type: ''});

        const langInstruction = getLanguageInstruction(userLevel);
        const keywordInfo = userKeywords.length > 0 ? `Their personal interests are: ${keywordsText}.` : '';
        
        const geminiPrompt = `You are an expert ESL tutor. A student at proficiency level ${userLevel} is practicing the verb "${verb[1]}". ${keywordInfo}
        ${langInstruction}
        The student's sentence is: "${userInput}"
        1. Analyze the sentence for correctness (grammar, verb form).
        2. Evaluate if the sentence complexity is appropriate for a ${userLevel} student. A simple "I saw a dog" is too basic for a B2 user.
        3. If the sentence is correct BUT too simple for their level, your feedback must encourage them to add more detail (e.g., "That's correct! Can you make it more detailed for your level?").
        Respond ONLY with a JSON object:
        {
          "is_fully_correct": boolean,
          "is_level_appropriate": boolean,
          "feedback": "Your feedback."
        }`;
        
        try {
            const result = await callGemini(geminiPrompt, true);
            
            if (!result.is_fully_correct) {
                setFeedback({ text: result.feedback, type: 'incorrect' });
                onFinish(verb, false, userInput, result.feedback);
            } else if (result.is_fully_correct && result.is_level_appropriate) {
                setFeedback({ text: result.feedback, type: 'correct' });
                setTimeout(() => { onFinish(verb, true); backToDash(); }, 2500);
            } else if (result.is_fully_correct && !result.is_level_appropriate) {
                setFeedback({ text: result.feedback, type: 'warning' });
                setNeedsImprovement(true);
                // Don't call onFinish - keep user on screen to improve
            }
        } catch (error) {
            console.error("Gemini API Error:", error);
            // Don't log technical errors as student mistakes
            setFeedback({ text: "Technical error occurred. Please try again.", type: 'warning' });
        }
        setIsLoading(false);
    };

    // Render A1 fill-in-the-gap exercise
    if (userLevel === 'A1') {
        return (
            <div>
                <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
                <div className="text-center mb-6 p-4 bg-blue-50 rounded-lg">
                    <h2 className="text-3xl font-bold">{verb[0]} <span className="text-xl font-normal text-gray-600">({verb[3]})</span></h2>
                    {!showForms && <button onClick={() => setShowForms(true)} className="text-sm text-blue-500 hover:underline">Don't know? Show forms</button>}
                    {showForms && <p className="text-lg text-blue-700 font-semibold">{verb[0]} / {verb[1]} / {verb[2]}</p>}
                </div>
                
                {isLoading && !exercise ? (
                    <p className="text-center">Loading your exercise...</p>
                ) : exercise ? (
                    <div className="text-center">
                        <h3 className="text-xl font-semibold mb-4">Fill in the gap:</h3>
                        <p className="text-2xl mb-4" dangerouslySetInnerHTML={{ __html: exercise.question.replace(/_+/g, '<strong class="text-blue-600 text-3xl">____</strong>') }}></p>
                        <input 
                            type="text" 
                            value={userInput} 
                            onChange={(e) => setUserInput(e.target.value)} 
                            className="w-full max-w-xs p-3 border-2 border-gray-300 rounded-lg text-center text-lg" 
                            placeholder="Type the verb here"
                        />
                        <button onClick={handleA1Submit} disabled={isLoading || !userInput} className="mt-4 w-full bg-green-600 text-white py-3 rounded-lg disabled:bg-gray-400 text-lg font-semibold">Check Answer</button>
                    </div>
                ) : (
                    <p className="text-center text-red-500">Could not load exercise. Please try again.</p>
                )}
                
                {feedback.text && (
                    <div className={`mt-4 p-3 rounded-lg text-center font-medium ${feedback.type === 'correct' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {feedback.text}
                    </div>
                )}
            </div>
        );
    }

    // Render A2+ sentence creation exercise
    return (
        <div>
            <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
            <div className="text-center mb-6 p-4 bg-blue-50 rounded-lg">
                <h2 className="text-3xl font-bold">{verb[0]} <span className="text-xl font-normal text-gray-600">({verb[3]})</span></h2>
                {!showForms && <button onClick={() => setShowForms(true)} className="text-sm text-blue-500 hover:underline">Don't know? Show forms</button>}
                {showForms && <p className="text-lg text-blue-700 font-semibold">{verb[0]} / {verb[1]} / {verb[2]}</p>}
            </div>
            
            <div className="text-center">
                <p className="mb-2 text-lg">Use "<strong>{verbToPractice}</strong>" (Past Simple) in a sentence:</p>
                
                {userLevel === 'A2' && (
                    <div className="mb-4">
                        {!showHint ? (
                            <button onClick={getHint} disabled={isLoading} className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 disabled:bg-gray-400">
                                {isLoading ? 'Getting hint...' : 'Get Hint'}
                            </button>
                        ) : (
                            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg">
                                <p className="text-yellow-800"><strong>Hint:</strong> {hint}</p>
                            </div>
                        )}
                    </div>
                )}
                
                <textarea 
                    value={userInput} 
                    onChange={(e) => setUserInput(e.target.value)} 
                    className="w-full p-2 border-2 border-gray-300 rounded-lg" 
                    rows="3" 
                    placeholder={userLevel === 'A2' ? "Use the hint above to help you!" : `e.g., I ${verbToPractice} a new book yesterday.`}
                />
                <button onClick={handleSentenceSubmit} disabled={isLoading} className="mt-3 w-full bg-green-600 text-white py-2 rounded-lg disabled:bg-gray-400">
                    {isLoading ? 'AI Tutor is Checking...' : 'Check My Sentence'}
                </button>
                
                {needsImprovement && (
                    <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <p className="text-orange-800 font-medium">Try to make your sentence more detailed for your level. You can edit it above and submit again!</p>
                    </div>
                )}
            </div>
            
            {feedback.text && (
                <div className={`mt-4 p-3 rounded-lg text-center font-medium ${
                    feedback.type === 'correct' ? 'bg-green-100 text-green-800' : 
                    feedback.type === 'warning' ? 'bg-orange-100 text-orange-800' : 
                    'bg-red-100 text-red-800'
                }`}>
                    {feedback.text}
                </div>
            )}
        </div>
    );
}

// --- PROGRESS SCREEN ---
function ProgressScreen({ userProgress, irregularVerbs, backToDash, onAddVerb, userKeywords, db, appId }) {
    const [showAddForm, setShowAddForm] = useState(false);
    const [isBulkAdding, setIsBulkAdding] = useState(false);

    const sortedVerbs = useMemo(() => {
        return irregularVerbs.map(verb => ({ verb, progress: userProgress[verb[0]] })).sort((a, b) => {
            const levelOrder = { 'Mastered': 2, 'Learning': 1, 'New': 0 };
            if (!a.progress || !b.progress) return 0;
            return levelOrder[b.progress.level] - levelOrder[a.progress.level];
        });
    }, [userProgress, irregularVerbs]);

    const handleBulkAdd = async () => {
        console.log("🔵 handleBulkAdd called"); // Debug step 1
        
        // Skip confirmation in sandboxed environment - just proceed directly
        console.log("🟢 Starting bulk add (no confirmation needed)"); // Debug step 2
        setIsBulkAdding(true);
        
        console.log("📊 irregularVerbs:", irregularVerbs); // Debug step 3
        console.log("🏷️ userKeywords:", userKeywords); // Debug step 4
        
        const existingVerbs = irregularVerbs.map(v => v[0]).join(', ');
        const keywordsText = userKeywords.length > 0 ? userKeywords.join(', ') : 'common topics';
        
        console.log("📝 existingVerbs:", existingVerbs); // Debug step 5
        console.log("🎯 keywordsText:", keywordsText); // Debug step 6
        
        const prompt = `A user wants to learn 5 new English irregular verbs.
        Their interests are: ${keywordsText}.
        They already know these verbs: ${existingVerbs}.
        Suggest FIVE new, useful, and common irregular verbs relevant to their interests but not on their list.
        Respond ONLY with a JSON object containing a single key "verbs" which is an array of objects:
        {"verbs": [
          {"infinitive": "...", "pastSimple": "...", "pastParticiple": "...", "polish": "..."},
          {"infinitive": "...", "pastSimple": "...", "pastParticiple": "...", "polish": "..."}
        ]}`;
        
        console.log("🤖 About to call Gemini API"); // Debug step 7
        
        try {
            const result = await callGemini(prompt, true);
            console.log("✅ Gemini response:", result); // Debug step 8
            
            const newVerbs = result.verbs;
            if (newVerbs && newVerbs.length > 0) {
                console.log("📚 Processing", newVerbs.length, "verbs"); // Debug step 9
                
                // Use a batch write for efficiency
                const batch = writeBatch(db);
                const verbsCollectionRef = collection(db, `artifacts/${appId}/public/data/irregularVerbs`);
                newVerbs.forEach(verb => {
                    const newVerbRef = doc(verbsCollectionRef); // Create a new doc with a random ID
                    batch.set(newVerbRef, {
                        infinitive: verb.infinitive.toLowerCase().trim(),
                        pastSimple: verb.pastSimple.toLowerCase().trim(),
                        pastParticiple: verb.pastParticiple.toLowerCase().trim(),
                        polish: verb.polish.toLowerCase().trim()
                    });
                });

                console.log("💾 About to commit batch to Firebase"); // Debug step 10
                await batch.commit();
                console.log("🎉 Batch committed successfully"); // Debug step 11
                console.log(`✅ ${newVerbs.length} new verbs have been successfully added!`);
            } else {
                console.log("❌ No verbs returned from AI");
                console.log("ℹ️ The AI couldn't suggest any new verbs at this time.");
            }
        } catch (e) {
            console.error("💥 Bulk add error:", e);
            console.log("❌ An error occurred while trying to bulk add verbs.");
        }
        setIsBulkAdding(false);
        console.log("🔴 handleBulkAdd finished"); // Debug step 12
    };

    return (
        <div>
            <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Your Progress</h2>
                <div className="flex gap-2">
                    <button 
                        onClick={handleBulkAdd} 
                        disabled={isBulkAdding}
                        className="bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
                    >
                        {isBulkAdding ? 'Adding...' : 'Suggest 5 Verbs'}
                    </button>
                    <button onClick={() => setShowAddForm(!showAddForm)} className="bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700">
                        {showAddForm ? 'Cancel' : 'Add New Verb'}
                    </button>
                </div>
            </div>
            {showAddForm && <AddVerbForm onSave={onAddVerb} onCancel={() => setShowAddForm(false)} userKeywords={userKeywords} irregularVerbs={irregularVerbs} />}
            <div className="space-y-3 mt-4">
                {sortedVerbs.map(({ verb, progress }) => (
                    <VerbCard key={verb[0]} verb={verb} progress={progress} />
                ))}
            </div>
        </div>
    );
}

// --- ADD VERB FORM ---
function AddVerbForm({ 
    onSave, 
    onCancel, 
    userKeywords = [],    // <-- FIX #1: Default to empty array
    irregularVerbs = []   // <-- FIX #2: Default to empty array
}) {
    const [infinitive, setInfinitive] = useState('');
    const [pastSimple, setPastSimple] = useState('');
    const [pastParticiple, setPastParticiple] = useState('');
    const [polish, setPolish] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleAiSuggest = async () => {
        if (!infinitive.trim()) { setError("Please enter an infinitive first."); return; }
        setIsLoading(true);
        setError('');
        const prompt = `For the English infinitive verb "${infinitive.trim()}", provide its Past Simple, Past Participle, and Polish translation. Respond ONLY with a JSON object: {"pastSimple": "...", "pastParticiple": "...", "polish": "..."}`;
        try {
            const result = await callGemini(prompt, true);
            setPastSimple(result.pastSimple);
            setPastParticiple(result.pastParticiple);
            setPolish(result.polish);
        } catch (e) { 
            setError("Could not get AI suggestion. Please try again."); 
            console.log("❌ Could not get AI suggestion:", e);
        }
        setIsLoading(false);
    };

    const handleSuggestVerb = async () => {
        setIsLoading(true);
        setError('');
        
        // THE FIX: Add a check to ensure irregularVerbs is an array.
        // If it's empty or not an array, default to a clear word for the prompt.
        const existingVerbs = (Array.isArray(irregularVerbs) && irregularVerbs.length > 0)
            ? irregularVerbs.map(v => v[0]).join(', ')
            : 'none'; // Use a clear word like 'none' for the prompt
        const keywordsText = userKeywords.length > 0 ? userKeywords.join(', ') : 'common topics';
        const prompt = `A user wants to learn a new English irregular verb.
        Their interests are: ${keywordsText}.
        They already know these verbs: ${existingVerbs}.
        Suggest ONE new, useful, and common irregular verb that is relevant to their interests but is NOT on their list.
        Respond ONLY with a JSON object: {"infinitive": "...", "pastSimple": "...", "pastParticiple": "...", "polish": "..."}`;
        
        try {
            const result = await callGemini(prompt, true);
            // Populate all fields at once
            setInfinitive(result.infinitive);
            setPastSimple(result.pastSimple);
            setPastParticiple(result.pastParticiple);
            setPolish(result.polish);
        } catch (e) {
            setError("Could not get an AI suggestion. Please try again.");
        }
        setIsLoading(false);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!infinitive || !pastSimple || !pastParticiple || !polish) { setError('All fields are required.'); return; }
        onSave({ 
            infinitive: infinitive.toLowerCase().trim(), 
            pastSimple: pastSimple.toLowerCase().trim(), 
            pastParticiple: pastParticiple.toLowerCase().trim(), 
            polish: polish.toLowerCase().trim() 
        });
        onCancel();
    };

    return (
        <form onSubmit={handleSubmit} className="p-4 border rounded-lg bg-gray-50 space-y-3">
            <h3 className="text-lg font-semibold text-center">Add a New Irregular Verb</h3>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <div className="flex items-center gap-2">
                <input 
                    type="text" 
                    value={infinitive} 
                    onChange={e => setInfinitive(e.target.value)} 
                    placeholder="Infinitive (e.g., go)" 
                    className="p-2 border rounded w-full"
                />
                <button 
                    type="button" 
                    onClick={handleAiSuggest} 
                    disabled={isLoading} 
                    className="bg-blue-500 text-white p-2 rounded whitespace-nowrap disabled:bg-gray-400"
                >
                    {isLoading ? '...' : 'Suggest Forms'}
                </button>
                <button 
                    type="button" 
                    onClick={handleSuggestVerb} 
                    disabled={isLoading} 
                    className="bg-purple-500 text-white p-2 rounded whitespace-nowrap disabled:bg-gray-400"
                >
                    {isLoading ? '...' : 'Suggest a Verb'}
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input 
                    type="text" 
                    value={pastSimple} 
                    onChange={e => setPastSimple(e.target.value)} 
                    placeholder="Past Simple" 
                    className="p-2 border rounded"
                />
                <input 
                    type="text" 
                    value={pastParticiple} 
                    onChange={e => setPastParticiple(e.target.value)} 
                    placeholder="Past Participle" 
                    className="p-2 border rounded"
                />
                <input 
                    type="text" 
                    value={polish} 
                    onChange={e => setPolish(e.target.value)} 
                    placeholder="Polish Translation" 
                    className="p-2 border rounded"
                />
            </div>
            <div className="flex gap-3">
                <button type="button" onClick={onCancel} className="w-full bg-gray-500 text-white py-2 rounded">Cancel</button>
                <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded">Save Verb</button>
            </div>
        </form>
    );
}

// --- VERB CARD COMPONENT ---
function VerbCard({ verb, progress }) {
    if (!progress) return null;
    const levelColor = { 
        'New': 'bg-blue-200 text-blue-800', 
        'Learning': 'bg-yellow-200 text-yellow-800', 
        'Mastered': 'bg-green-200 text-green-800' 
    }[progress.level];

    return (
        <div className="p-3 bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="flex justify-between items-center">
                <div>
                    <p className="font-bold text-lg">{verb[0]} <span className="text-base font-normal text-gray-500">({verb[3]})</span></p>
                    <p className="text-sm text-gray-600">{verb[1]} / {verb[2]}</p>
                </div>
                <div className="text-right">
                    <span className={`px-3 py-1 text-sm font-semibold rounded-full ${levelColor}`}>{progress.level}</span>
                    <p className="text-xs text-gray-500 mt-1">
                        <span className="text-green-600">✓ {progress.correct}</span> | <span className="text-red-600">✗ {progress.incorrect}</span>
                    </p>
                </div>
            </div>
        </div>
    );
}

// --- GEMINI API CALL FUNCTION ---
async function callGemini(prompt, isJson = false) {
    const apiKey = ""; // Handled by environment
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const payload = { 
        contents: [{ role: "user", parts: [{ text: prompt }] }], 
        ...(isJson && { generationConfig: { responseMimeType: "application/json" } }) 
    };
    try {
        const response = await fetch(apiUrl, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error("API Error Response:", errorBody);
            throw new Error(`API call failed: ${response.status}`);
        }
        const result = await response.json();
        const text = result.candidates[0].content.parts[0].text;
        return isJson ? JSON.parse(text) : text;
    } catch (error) { 
        console.error("Gemini API Error:", error); 
        throw error; 
    }
}

export default App;
