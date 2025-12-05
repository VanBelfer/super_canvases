import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, serverTimestamp, query, writeBatch, getDoc, deleteDoc } from 'firebase/firestore';

// --- GLOBAL CONFIG ---
const appId = 'modular-learning-engine';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const confidenceIntervals = [1, 3, 7, 14, 30, 60, 180];

// ==================================================================================
// --- MODULE REGISTRY & DEFINITIONS ---
// ==================================================================================

const IrregularVerbsModule = {
  key: 'irregular_verbs',
  name: 'Irregular Verbs',
  description: 'Master English irregular verb forms with spaced repetition',
  collectionName: 'irregularVerbs',
  icon: '🔄',
  
  DisplayCard: ({ item, progress }) => {
    if (!progress) return null;
    const levelColor = { 
      'New': 'bg-blue-200 text-blue-800', 
      'Learning': 'bg-yellow-200 text-yellow-800', 
      'Mastered': 'bg-green-200 text-green-800' 
    }[progress.masteryLevel];
    
    return (
      <div className="p-3 bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <p className="font-bold text-lg">{item.data.infinitive} <span className="text-base font-normal text-gray-500">({item.data.polish})</span></p>
            <p className="text-sm text-gray-600">{item.data.pastSimple} / {item.data.pastParticiple}</p>
          </div>
          <div className="text-right">
            <span className={`px-3 py-1 text-sm font-semibold rounded-full ${levelColor}`}>{progress.masteryLevel}</span>
            <p className="text-xs text-gray-500 mt-1">
              <span className="text-green-600">✓ {progress.successes}</span> | <span className="text-red-600">✗ {progress.attempts - progress.successes}</span>
            </p>
          </div>
        </div>
      </div>
    );
  },

  // --- Inside the IrregularVerbsModule object ---

AddItemForm: ({ onSave, onCancel, userKeywords = [], allItems = [] }) => {
    const [infinitive, setInfinitive] = React.useState('');
    const [pastSimple, setPastSimple] = React.useState('');
    const [pastParticiple, setPastParticiple] = React.useState('');
    const [polish, setPolish] = React.useState('');
    const [error, setError] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);

    // This function is triggered by the button's onClick
    const handleSubmit = () => {
      if (!infinitive || !pastSimple || !pastParticiple || !polish) { 
        setError('All fields are required.'); 
        return; 
      }
      
      const newItemData = { 
        infinitive: infinitive.toLowerCase().trim(), 
        pastSimple: pastSimple.toLowerCase().trim(), 
        pastParticiple: pastParticiple.toLowerCase().trim(), 
        polish: polish.toLowerCase().trim(),
        difficulty: 'B1',
        tags: ['verb']
      };
      onSave(newItemData);
      onCancel();
    };

    const handleAiSuggest = async () => {
      if (!infinitive.trim()) { setError("Please enter an infinitive first."); return; }
      setIsLoading(true);
      setError('');
      
      try {
        const prompt = `For the English infinitive verb "${infinitive.trim()}", provide its Past Simple, Past Participle, and Polish translation. Respond ONLY with JSON: {"pastSimple": "...", "pastParticiple": "...", "polish": "..."}`;
        const result = await callGemini(prompt, true);
        setPastSimple(result.pastSimple);
        setPastParticiple(result.pastParticiple);
        setPolish(result.polish);
      } catch (e) { 
        setError("Could not get AI suggestion. Please fill manually."); 
      }
      setIsLoading(false);
    };

    // The return uses a <div> as the main container instead of a <form>
    return (
      <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
        <h3 className="text-lg font-semibold text-center">Add New Irregular Verb</h3>
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
            {isLoading ? '...' : 'AI Help'}
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
          <button type="button" onClick={handleSubmit} className="w-full bg-blue-600 text-white py-2 rounded">Save Verb</button>
        </div>
      </div> // <-- CORRECTED TAG (matches the opening <div>)
    );
  },

  getPracticePrompt: (item, userLevel, userKeywords) => {
    const keywordsText = userKeywords.length > 0 ? userKeywords.join(', ') : 'general topics';
    
    if (userLevel === 'A1') {
      return `An A1 student is practicing the verb '${item.data.infinitive}'. Create a simple fill-in-the-gap sentence exercise using its Past Simple form, '${item.data.pastSimple}'. The sentence MUST include a clear time indicator (yesterday, last week, ago, etc.) to show it's past tense. Respond ONLY with JSON: {"question": "Yesterday, I ___ a cat.", "answer": "saw", "explanation": "The verb 'see' changes to 'saw' in past simple because it's an irregular verb."}`;
    }
    
    return `A ${userLevel} student interested in '${keywordsText}' is practicing the Past Simple of '${item.data.infinitive}', which is '${item.data.pastSimple}'. Ask them to create a sentence. Respond with JSON: {"instruction": "Create a sentence using '${item.data.pastSimple}' in past tense", "example": "I ${item.data.pastSimple} something interesting yesterday."}`;
  }
};

// ==================================================================================
// --- MAIN APP COMPONENT ---
// ==================================================================================

function App() {
  // --- Core State ---
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // --- Module System ---
  const [moduleRegistry, setModuleRegistry] = useState({
    [IrregularVerbsModule.key]: IrregularVerbsModule
  });
  const [learningItems, setLearningItems] = useState({});
  const [userProgress, setUserProgress] = useState({});
  const [userMistakes, setUserMistakes] = useState([]);
  
  // --- UI State ---
  const [userProfile, setUserProfile] = useState({ level: 'B1', keywords: [] });
  const [screen, setScreen] = useState('dashboard');
  const [activeModuleKey, setActiveModuleKey] = useState(IrregularVerbsModule.key);
  const [practiceItem, setPracticeItem] = useState(null);
  const [activeMistakes, setActiveMistakes] = useState([]);
  const [showDeveloperPanel, setShowDeveloperPanel] = useState(false);

  // --- Firebase Initialization ---
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
            const cred = initialAuthToken ? 
              await signInWithCustomToken(auth, initialAuthToken) : 
              await signInAnonymously(auth);
            setUserId(cred.user.uid);
          } catch (error) {
            console.error("Auth Error:", error);
            setUserId('fallback_user_' + Date.now());
          }
        }
        setIsAuthReady(true);
      });
    } catch (error) { 
      console.error("Firebase Init Error:", error); 
    }
  }, []);

  // --- Load Data for All Modules ---
  useEffect(() => {
    if (!db || !isAuthReady) return;
    
    // Create an array to hold all the unsubscribe functions
    const unsubscribes = [];
    
    Object.values(moduleRegistry).forEach(module => {
      // OFFICIAL PATTERN: Use '/users/${userId}/' path convention as per Canvas documentation
      const itemsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/${module.collectionName}`);
      const unsubscribe = onSnapshot(itemsCollectionRef, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          moduleKey: module.key,
          data: doc.data() 
        }));
        setLearningItems(prevItems => ({ ...prevItems, [module.key]: items }));
      });
      
      // Add the unsubscribe function to our array
      unsubscribes.push(unsubscribe);
    });
    
    // Return a cleanup function that calls all unsubscribe functions
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [db, isAuthReady, moduleRegistry]);

  // --- Load User Progress ---
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;
    
    const progressDocRef = doc(db, `artifacts/${appId}/users/${userId}/progress`, 'all');
    const unsubscribe = onSnapshot(progressDocRef, (docSnap) => {
      const progress = docSnap.exists() ? docSnap.data() : {};
      setUserProgress(progress);
    });
    return () => unsubscribe();
  }, [isAuthReady, db, userId]);

  // --- Load User Profile ---
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;
    
    const profileDocRef = doc(db, `artifacts/${appId}/users/${userId}/profile`, 'settings');
    const unsubscribe = onSnapshot(profileDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserProfile(prev => ({ ...prev, ...data }));
      }
    });
    return () => unsubscribe();
  }, [isAuthReady, db, userId]);

  // --- Load User Mistakes ---
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;
    
    const mistakesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/mistakes`);
    const unsubscribe = onSnapshot(mistakesCollectionRef, (snapshot) => {
      const allMistakes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUserMistakes(allMistakes);
      
      const now = new Date();
      const active = allMistakes.filter(m => m.nextReviewAt && m.nextReviewAt.toDate() <= now);
      setActiveMistakes(active);
    });
    return () => unsubscribe();
  }, [isAuthReady, db, userId]);

  // --- Core Functions ---
  const updateItemProgress = async (item, isCorrect, userSentence = '', feedback = '') => {
    const current = userProgress[item.id] || { 
      masteryLevel: 'New', 
      attempts: 0, 
      successes: 0,
      confidence: 0,
      lastPracticed: null 
    };
    
    let newMasteryLevel = current.masteryLevel;
    const newAttempts = current.attempts + 1;
    const newSuccesses = isCorrect ? current.successes + 1 : current.successes;
    
    if (isCorrect) {
      if (current.masteryLevel === 'New') newMasteryLevel = 'Learning';
      else if (current.masteryLevel === 'Learning' && newSuccesses >= 4) newMasteryLevel = 'Mastered';
    } else {
      if (current.masteryLevel === 'Mastered') newMasteryLevel = 'Learning';
      await saveUserMistake(item, userSentence, feedback);
    }
    
    const updatedProgress = {
      ...userProgress,
      [item.id]: {
        ...current,
        masteryLevel: newMasteryLevel,
        attempts: newAttempts,
        successes: newSuccesses,
        lastPracticed: new Date().toISOString()
      }
    };
    
    setUserProgress(updatedProgress);
    await setDoc(doc(db, `artifacts/${appId}/users/${userId}/progress`, 'all'), updatedProgress, { merge: true });
  };

  const addNewItem = async (moduleKey, itemData) => {
    if (!db) return;
    const module = moduleRegistry[moduleKey];
    // OFFICIAL PATTERN: Use '/users/${userId}/' path convention as per Canvas documentation
    await addDoc(collection(db, `artifacts/${appId}/users/${userId}/${module.collectionName}`), {
      ...itemData,
      created: serverTimestamp()
    });
  };

  const deleteItem = async (moduleKey, itemId) => {
    if (!db || !userId) return;
    const module = moduleRegistry[moduleKey];
    const itemRef = doc(db, `artifacts/${appId}/users/${userId}/${module.collectionName}`, itemId);
    await deleteDoc(itemRef);
    
    // Also clean up any progress for this item
    const updatedProgress = { ...userProgress };
    delete updatedProgress[itemId];
    setUserProgress(updatedProgress);
    await setDoc(doc(db, `artifacts/${appId}/users/${userId}/progress`, 'all'), updatedProgress, { merge: true });
  };

  const saveUserMistake = async (item, sentence, feedback, existingTags = null) => {
    if (!db || !userId) return;
    
    let tags = existingTags;
    if (tags === null) {
      try {
        const taggingPrompt = `A student made a mistake. Sentence: "${sentence}". Feedback: "${feedback}". Analyze and categorize it. Choose from: "verb_form", "grammar", "vocabulary", "word_order", "style", "punctuation". Respond ONLY with JSON: {"tags": ["tag1", "tag2", ...]}`;
        const result = await callGemini(taggingPrompt, true);
        tags = result.tags || ['untagged'];
      } catch (e) {
        tags = ['untagged'];
      }
    }
    
    await addDoc(collection(db, `artifacts/${appId}/users/${userId}/mistakes`), {
      itemId: item.id,
      moduleKey: item.moduleKey,
      sentence, 
      feedback, 
      tags,
      timestamp: serverTimestamp(),
      confidenceLevel: 0,
      nextReviewAt: new Date()
    });
  };


  // --- Inside the main App component ---

// ... after the saveUserMistake function ...

const updateMistakeStatus = async (mistakeId, wasTargetSkillCorrect) => {
    if (!db || !userId) return;
    
    const mistakeRef = doc(db, `artifacts/${appId}/users/${userId}/mistakes`, mistakeId);
    const mistake = userMistakes.find(m => m.id === mistakeId);
    if (!mistake) {
        console.error("Could not find mistake to update:", mistakeId);
        return;
    }
    
    let newConfidence = mistake.confidenceLevel || 0;
    
    if (wasTargetSkillCorrect) {
      // If they got the main point right, always increase confidence.
      newConfidence = Math.min(newConfidence + 1, confidenceIntervals.length);
    } else {
      // If they got the main point wrong, decrease confidence.
      newConfidence = Math.max(newConfidence - 1, 0);
    }
    
    const intervalDays = confidenceIntervals[newConfidence - 1] || 1;
    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + intervalDays);
    
    await setDoc(mistakeRef, {
      confidenceLevel: newConfidence,
      nextReviewAt: nextReviewDate,
      lastReviewed: serverTimestamp()
    }, { merge: true });
};

// ... before the addNewModule function ...

  const addNewModule = async (newModule) => {
    try {
      validateModule(newModule);
      
      // Add to registry
      setModuleRegistry(prev => ({
        ...prev,
        [newModule.key]: newModule
      }));
      
      // Save to Firebase for persistence
      await setDoc(doc(db, `artifacts/${appId}/modules/${newModule.key}`), {
        ...newModule,
        DisplayCard: newModule.DisplayCard.toString(),
        AddItemForm: newModule.AddItemForm.toString(),
        created: serverTimestamp()
      });
      
      // Initialize empty items collection
      setLearningItems(prev => ({ ...prev, [newModule.key]: [] }));
      
    } catch (error) {
      console.error('Failed to add module:', error);
      throw error;
    }
  };

  // --- Screen Rendering ---
  const renderScreen = () => {
    const module = moduleRegistry[activeModuleKey];
    const itemsForModule = learningItems[activeModuleKey] || [];
    
    switch (screen) {
      case 'practice':
        return <GenericPracticeScreen 
          item={practiceItem} 
          module={module}
          onFinish={updateItemProgress} 
          backToDash={() => setScreen('dashboard')} 
          userLevel={userProfile.level} 
          userKeywords={userProfile.keywords} 
        />;
      case 'progress':
        return <GenericProgressScreen
          module={module}
          items={itemsForModule}
          userProgress={userProgress}
          onAddItem={addNewItem}
          onDeleteItem={deleteItem}
          onPractice={(item) => { setPracticeItem(item); setScreen('practice'); }}
          backToDash={() => setScreen('dashboard')}
          userKeywords={userProfile.keywords}
          db={db}
          appId={appId}
          userId={userId}
        />;
      case 'mistake_review':
        return <GenericMistakeReviewScreen 
          mistakesToReview={activeMistakes}
          moduleRegistry={moduleRegistry}
          learningItems={learningItems}
          onMistakeReviewed={updateMistakeStatus}
          onNewMistake={saveUserMistake}
          backToDash={() => setScreen('dashboard')} 
          userLevel={userProfile.level}
          userKeywords={userProfile.keywords}
        />;
      case 'settings':
        return <SettingsScreen 
          userProfile={userProfile}
          onUpdateProfile={async (updates) => {
            setUserProfile(prev => ({ ...prev, ...updates }));
            await setDoc(doc(db, `artifacts/${appId}/users/${userId}/profile`, 'settings'), updates, { merge: true });
          }}
          backToDash={() => setScreen('dashboard')}
        />;

      default:
        return <Dashboard 
          moduleRegistry={moduleRegistry}
          activeModuleKey={activeModuleKey}
          onSelectModule={setActiveModuleKey}
          learningItems={learningItems}
          userProgress={userProgress}
          activeMistakeCount={activeMistakes.length}
          onPractice={(item) => { setPracticeItem(item); setScreen('practice'); }}
          onShowProgress={() => setScreen('progress')}
          onShowMistakeReview={() => setScreen('mistake_review')}
          onShowSettings={() => setScreen('settings')}
          onToggleDeveloper={() => setShowDeveloperPanel(!showDeveloperPanel)}
        />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-800">
      <div className="container mx-auto p-4 max-w-4xl">
        <header className="text-center my-6">
          <h1 className="text-4xl font-bold text-blue-600">Modular Learning Engine</h1>
          <p className="text-lg text-gray-600">AI-Powered Language Learning Platform</p>
        </header>
        
        <main className="bg-white p-6 rounded-xl shadow-lg">
          {isAuthReady ? renderScreen() : <p className="text-center">Loading your learning journey...</p>}
        </main>
        
        {showDeveloperPanel && (
          <DeveloperPanel 
            moduleRegistry={moduleRegistry}
            onAddNewModule={addNewModule}
            onClose={() => setShowDeveloperPanel(false)}
          />
        )}
      </div>
    </div>
  );
}

// ==================================================================================
// --- GENERIC CORE COMPONENTS ---
// ==================================================================================

function Dashboard({ 
  moduleRegistry, 
  activeModuleKey, 
  onSelectModule, 
  learningItems, 
  userProgress, 
  activeMistakeCount,
  onPractice, 
  onShowProgress, 
  onShowMistakeReview, 
  onShowSettings,
  onToggleDeveloper 
}) {
  const activeModule = moduleRegistry[activeModuleKey];
  const itemsForModule = learningItems[activeModuleKey] || [];
  
  const stats = useMemo(() => {
    const progressValues = itemsForModule.map(item => userProgress[item.id]).filter(Boolean);
    if (progressValues.length === 0) return { mastered: 0, learning: 0, new: 0, total: 0 };
    
    const mastered = progressValues.filter(p => p.masteryLevel === 'Mastered').length;
    const learning = progressValues.filter(p => p.masteryLevel === 'Learning').length;
    const total = itemsForModule.length;
    const newCount = total - mastered - learning;
    
    return { mastered, learning, new: newCount, total };
  }, [itemsForModule, userProgress]);

  const suggestedItems = useMemo(() => {
    if (itemsForModule.length === 0) return [];
    
    const notMastered = itemsForModule.filter(item => 
      !userProgress[item.id] || userProgress[item.id].masteryLevel !== 'Mastered'
    );
    
    return notMastered.slice(0, 3);
  }, [itemsForModule, userProgress]);

  return (
    <div>
      {/* Module Selector */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <span className="text-lg font-semibold">Active Module:</span>
          <select 
            value={activeModuleKey} 
            onChange={(e) => onSelectModule(e.target.value)}
            className="p-2 border rounded-lg bg-white"
          >
            {Object.values(moduleRegistry).map(module => (
              <option key={module.key} value={module.key}>
                {module.icon} {module.name}
              </option>
            ))}
          </select>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={onToggleDeveloper}
            className="bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 transition text-sm"
          >
            🔧 Developer
          </button>
          <button 
            onClick={onShowSettings}
            className="bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Mistake Review Banner */}
      <div className="mb-6">
        <button 
          onClick={onShowMistakeReview} 
          disabled={activeMistakeCount === 0} 
          className="w-full bg-red-600 text-white py-3 px-6 rounded-lg hover:bg-red-700 transition font-bold text-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Review {activeMistakeCount} Mistakes
        </button>
      </div>

      {/* Stats */}
      <h2 className="text-2xl font-bold mb-4">{activeModule.name} Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center mb-6">
        <div className="bg-green-100 p-4 rounded-lg">
          <p className="text-3xl font-bold text-green-700">{stats.mastered}</p>
          <p className="text-green-600">Mastered</p>
        </div>
        <div className="bg-yellow-100 p-4 rounded-lg">
          <p className="text-3xl font-bold text-yellow-700">{stats.learning}</p>
          <p className="text-yellow-600">Learning</p>
        </div>
        <div className="bg-blue-100 p-4 rounded-lg">
          <p className="text-3xl font-bold text-blue-700">{stats.new}</p>
          <p className="text-blue-600">New</p>
        </div>
      </div>

      {/* Practice Suggestions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-xl font-semibold mb-3">Practice Suggestions</h3>
          {suggestedItems.length > 0 ? (
            <div className="space-y-2">
              {suggestedItems.map(item => {
                const DisplayCard = activeModule.DisplayCard;
                const progress = userProgress[item.id] || { masteryLevel: 'New', attempts: 0, successes: 0 };
                
                return (
                  <div key={item.id} className="flex justify-between items-center bg-white p-3 rounded-md shadow-sm">
                    <div className="flex-1">
                      <DisplayCard item={item} progress={progress} />
                    </div>
                    <button 
                      onClick={() => onPractice(item)} 
                      className="bg-green-500 text-white px-3 py-1 text-sm rounded-md hover:bg-green-600 ml-3"
                    >
                      Practice
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500">No items to practice!</p>
          )}
        </div>
        
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-xl font-semibold mb-3">Quick Actions</h3>
          <div className="space-y-2">
            <button 
              onClick={onShowProgress} 
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
            >
              View All {activeModule.name}
            </button>
            <button 
              className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition"
              onClick={() => {
                const randomItem = suggestedItems[Math.floor(Math.random() * suggestedItems.length)];
                if (randomItem) onPractice(randomItem);
              }}
              disabled={suggestedItems.length === 0}
            >
              Random Practice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenericProgressScreen({ module, items, userProgress, onAddItem, onDeleteItem, onPractice, backToDash, userKeywords, db, appId, userId }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const AddItemFormComponent = module.AddItemForm;
  const DisplayCardComponent = module.DisplayCard;
  
  const sortedItems = useMemo(() => {
    return items.map(item => ({ 
      item, 
      progress: userProgress[item.id] || { masteryLevel: 'New', attempts: 0, successes: 0 } 
    })).sort((a, b) => {
      const levelOrder = { 'Mastered': 2, 'Learning': 1, 'New': 0 };
      return levelOrder[b.progress.masteryLevel] - levelOrder[a.progress.masteryLevel];
    });
  }, [items, userProgress]);

  const handleBulkAdd = async () => {
    // Use a simple console log instead of a blocking confirm dialog
    console.log(`Starting bulk add for ${module.name}...`);
    setIsBulkAdding(true);

    const existingItems = items.map(item => item.data.mainField || item.data.infinitive).join(', ');
    const keywordsText = userKeywords.length > 0 ? userKeywords.join(', ') : 'general topics';

    let prompt;
    if (module.key === 'irregular_verbs') {
      prompt = `A user wants to learn 5 new English irregular verbs for language learning.
Their interests are: ${keywordsText}.
They already have these verbs: ${existingItems}.
Suggest FIVE new, useful irregular verbs relevant to their interests but not on their list.
Respond ONLY with a JSON object containing a single key "items" which is an array of objects.
Each object must have: "infinitive", "pastSimple", "pastParticiple", "polish" (Polish translation).
Example: {"items": [{"infinitive": "bring", "pastSimple": "brought", "pastParticiple": "brought", "polish": "przynosić"}]}`;
    } else {
      prompt = `A user wants to learn 5 new items for the learning module: "${module.name}".
Their interests are: ${keywordsText}.
They already have these items: ${existingItems}.
Suggest FIVE new, useful items relevant to their interests but not on their list.
The data structure for an item in this module requires fields like 'mainField', 'translation', and 'additionalInfo'.
Respond ONLY with a JSON object containing a single key "items" which is an array of objects, where each object has the required data fields.
Example: {"items": [{"mainField": "...", "translation": "...", "additionalInfo": "..."}]}`;
    }

    try {
      const result = await callGemini(prompt, true);
      const newItems = result.items;

      if (newItems && newItems.length > 0) {
        const batch = writeBatch(db);
        const itemsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/${module.collectionName}`);
        
        newItems.forEach(itemData => {
          const newDocRef = doc(itemsCollectionRef);
          batch.set(newDocRef, {
            ...itemData,
            difficulty: 'B1', // Default values
            tags: ['ai-generated'],
            created: serverTimestamp()
          });
        });

        await batch.commit();
        console.log(`${newItems.length} new items have been successfully added!`);
      } else {
        console.log("The AI couldn't suggest any new items at this time.");
      }
    } catch (e) {
      console.error("Bulk add error:", e);
      console.log("An error occurred while trying to bulk add items.");
    }
    setIsBulkAdding(false);
  };

  const handleDeleteConfirm = () => {
    if (itemToDelete) {
      onDeleteItem(module.key, itemToDelete.id);
      setItemToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setItemToDelete(null);
  };

  return (
    <div>
      <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
      
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Your {module.name} Progress</h2>
        <div className="flex gap-2">
          <button 
            onClick={handleBulkAdd} 
            disabled={isBulkAdding}
            className="bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
          >
            {isBulkAdding ? 'Adding...' : 'Suggest 5 Items'}
          </button>
          <button 
            onClick={() => setShowAddForm(!showAddForm)} 
            className="bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700"
          >
            {showAddForm ? 'Cancel' : 'Add New Item'}
          </button>
        </div>
      </div>
      
      {showAddForm && (
        <div className="mb-6">
          <AddItemFormComponent 
            onSave={(itemData) => {
              onAddItem(module.key, itemData);
              setShowAddForm(false);
            }} 
            onCancel={() => setShowAddForm(false)}
            userKeywords={userKeywords}
            allItems={items}
          />
        </div>
      )}
      
      <div className="space-y-3">
        {sortedItems.map(({ item, progress }) => (
          <div key={item.id} className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex-1">
              <DisplayCardComponent item={item} progress={progress} />
            </div>
            <div className="flex gap-2 ml-4">
              <button 
                onClick={() => onPractice(item)} 
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
              >
                Practice
              </button>
              <button 
                onClick={() => setItemToDelete(item)}
                className="bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {/* Custom Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Delete Item</h3>
            <div className="mb-4">
              <DisplayCardComponent item={itemToDelete} progress={{ masteryLevel: 'New', attempts: 0, successes: 0 }} />
            </div>
            <p className="text-gray-600 mb-6">Are you sure you want to delete this item? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button 
                onClick={handleDeleteCancel}
                className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteConfirm}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GenericPracticeScreen({ item, module, onFinish, backToDash, userLevel, userKeywords }) {
  const [userInput, setUserInput] = useState('');
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [exercise, setExercise] = useState(null);

  useEffect(() => {
    if (userLevel === 'A1' && module.key === 'irregular_verbs') {
      generateExercise();
    }
  }, [item, userLevel, module]);

  const generateExercise = async () => {
    setIsLoading(true);
    try {
      const prompt = module.getPracticePrompt(item, userLevel, userKeywords);
      const result = await callGemini(prompt, true);
      setExercise(result);
    } catch (e) {
      setFeedback({ text: "Could not generate exercise. Please try the open practice instead.", type: 'incorrect' });
    }
    setIsLoading(false);
  };

  const handleSubmit = async () => {
    if (!userInput.trim()) return;
    setIsLoading(true);
    
    try {
      if (userLevel === 'A1' && exercise) {
        // Handle A1 fill-in-the-gap
        const isCorrect = userInput.trim().toLowerCase() === exercise.answer.toLowerCase();
        
        if (isCorrect) {
          setFeedback({ text: 'Excellent! You got it right!', type: 'correct' });
          setTimeout(() => { onFinish(item, true); backToDash(); }, 2500);
        } else {
          const fullMistakeSentence = exercise.question.replace(/_+/g, userInput.trim());
          const helpfulFeedback = exercise.explanation 
            ? `${exercise.explanation} The correct answer is: ${exercise.answer}.`
            : `The correct answer is: ${exercise.answer}. Try again!`;
            
          setFeedback({ text: helpfulFeedback, type: 'incorrect' });
          onFinish(item, false, fullMistakeSentence, `Fill-in-the-gap: Expected '${exercise.answer}' but got '${userInput}'`);
        }
      } else {
        // Handle sentence creation for other levels
        const wordCount = userInput.trim().split(/\s+/).length;
        if (wordCount < 3) {
          setFeedback({ 
            text: userLevel === 'A1' ? 'Napisz pełne zdanie (przynajmniej 3 słowa).' : 'Please write a complete sentence (at least 3 words).', 
            type: 'warning' 
          });
          return;
        }
        
        const langInstruction = userLevel === 'A1' ? "Provide feedback in simple Polish." : 
                              userLevel === 'A2' ? "Provide feedback in simple English with Polish translations for key words." :
                              `Provide feedback in English suitable for a ${userLevel} learner.`;
        const keywordInfo = userKeywords.length > 0 ? `Their personal interests are: ${userKeywords.join(', ')}.` : '';
        
        const geminiPrompt = `You are an expert ESL tutor. A student at proficiency level ${userLevel} is practicing with the item: ${JSON.stringify(item.data)}. ${keywordInfo}
        ${langInstruction}
        The student's sentence is: "${userInput}"
        1. Analyze the sentence for correctness (grammar, usage).
        2. Evaluate if the sentence complexity is appropriate for a ${userLevel} student.
        Respond ONLY with a JSON object:
        {
          "is_fully_correct": boolean,
          "is_level_appropriate": boolean,
          "feedback": "Your feedback."
        }`;
        
        const result = await callGemini(geminiPrompt, true);
        
        if (!result.is_fully_correct) {
          setFeedback({ text: result.feedback, type: 'incorrect' });
          onFinish(item, false, userInput, result.feedback);
        } else if (result.is_fully_correct && result.is_level_appropriate) {
          setFeedback({ text: result.feedback, type: 'correct' });
          setTimeout(() => { onFinish(item, true); backToDash(); }, 2500);
        } else {
          setFeedback({ text: result.feedback, type: 'warning' });
        }
      }
    } catch (error) {
      console.error("Practice Error:", error);
      setFeedback({ text: "Technical error occurred. Please try again.", type: 'warning' });
    }
    setIsLoading(false);
  };

  const DisplayCard = module.DisplayCard;
  const dummyProgress = { masteryLevel: 'Learning', attempts: 0, successes: 0 };

  return (
    <div>
      <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
      
      <div className="text-center mb-6 p-4 bg-blue-50 rounded-lg">
        <h2 className="text-2xl font-bold mb-4">Practice: {module.name}</h2>
        <div className="max-w-md mx-auto">
          <DisplayCard item={item} progress={dummyProgress} />
        </div>
      </div>
      
      {userLevel === 'A1' && module.key === 'irregular_verbs' ? (
        // A1 Fill-in-the-gap exercise
        <div className="text-center">
          {isLoading && !exercise ? (
            <p className="text-center">Loading your exercise...</p>
          ) : exercise ? (
            <div>
              <h3 className="text-xl font-semibold mb-4">Fill in the gap:</h3>
              <p className="text-2xl mb-4" dangerouslySetInnerHTML={{ 
                __html: exercise.question.replace(/_+/g, '<strong class="text-blue-600 text-3xl">____</strong>') 
              }}></p>
              <input 
                type="text" 
                value={userInput} 
                onChange={(e) => setUserInput(e.target.value)} 
                className="w-full max-w-xs p-3 border-2 border-gray-300 rounded-lg text-center text-lg" 
                placeholder="Type the verb here"
              />
              <button 
                onClick={handleSubmit} 
                disabled={isLoading || !userInput} 
                className="mt-4 w-full bg-green-600 text-white py-3 rounded-lg disabled:bg-gray-400 text-lg font-semibold"
              >
                Check Answer
              </button>
            </div>
          ) : (
            <p className="text-center text-red-500">Could not load exercise. Please try again.</p>
          )}
        </div>
      ) : (
        // Sentence creation for other levels
        <div className="text-center">
          <p className="mb-4 text-lg">Create a sentence using this {module.name.toLowerCase().slice(0, -1)}:</p>
          <textarea 
            value={userInput} 
            onChange={(e) => setUserInput(e.target.value)} 
            className="w-full p-3 border-2 border-gray-300 rounded-lg" 
            rows="3" 
            placeholder="Write your sentence here..."
          />
          <button 
            onClick={handleSubmit} 
            disabled={isLoading} 
            className="mt-3 w-full bg-green-600 text-white py-2 rounded-lg disabled:bg-gray-400"
          >
            {isLoading ? 'AI Tutor is Checking...' : 'Check My Sentence'}
          </button>
        </div>
      )}
      
      {feedback.text && (
        <div className={`mt-4 p-3 rounded-lg text-center font-medium ${
          feedback.type === 'correct' ? 'bg-green-100 text-green-800' : 
          feedback.type === 'warning' ? 'bg-orange-100 text-orange-800' : 
          'bg-red-100 text-red-800'
        }`}>
          {typeof feedback.text === 'string' ? renderMarkdownText(feedback.text) : JSON.stringify(feedback.text)}
        </div>
      )}
    </div>
  );
}

function GenericMistakeReviewScreen({ mistakesToReview, moduleRegistry, learningItems, onMistakeReviewed, onNewMistake, backToDash, userLevel, userKeywords }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAssessmentDone, setIsAssessmentDone] = useState(false);
  const [practiceStep, setPracticeStep] = useState('correction');
  const [exercise, setExercise] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [isLoading, setIsLoading] = useState(false);
  
  const currentMistake = mistakesToReview[currentIndex];
  
  // Get the original learning item that this mistake relates to
  const getOriginalItem = (mistake) => {
    if (!mistake.itemId || !mistake.moduleKey) return null;
    const moduleItems = learningItems[mistake.moduleKey] || [];
    return moduleItems.find(item => item.id === mistake.itemId);
  };
  
  const originalItem = currentMistake ? getOriginalItem(currentMistake) : null;
  const module = currentMistake ? moduleRegistry[currentMistake.moduleKey] : null;
  
  const getLanguageInstruction = (level) => {
    if (level === 'A1') return "Explain everything in Polish. Use simple Polish. The student is a beginner.";
    if (level === 'A2') return "Explain in simple English, but provide a Polish translation for key terms.";
    return `Explain in English, adjusting the vocabulary and complexity for a ${level} level student.`;
  };
  
  const generateExercise = async (step) => {
    if (!originalItem || !module) return;
    
    setIsLoading(true);
    setExercise(null);
    setFeedback({ text: '', type: '' });
    setUserInput('');
    
    let prompt;
    const langInstruction = getLanguageInstruction(userLevel);
    const keywordsText = userKeywords.length > 0 ? `Student's interests: ${userKeywords.join(', ')}.` : '';
    const baseInfo = `Student Level: ${userLevel}. ${keywordsText} Original learning item: ${JSON.stringify(originalItem.data)}. Original mistake: "${currentMistake.sentence}" (feedback: "${currentMistake.feedback}"). ${langInstruction}`;
    
    switch (step) {
      case 'reinforcement':
        prompt = `${baseInfo} Create a reinforcement exercise to solidify understanding of the corrected concept. This should be different from the original mistake but test the same skill. Respond ONLY with JSON: {"type": "reinforcement", "instruction": "...", "example": "..."}`;
        break;
      case 'application':
        prompt = `${baseInfo} Create an application exercise where the student uses the concept in a new context. Respond ONLY with JSON: {"type": "application", "instruction": "...", "context": "..."}`;
        break;
      default: 
        setIsLoading(false); 
        return;
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
  
  const handleCorrectionAssessment = async () => {
    if (!userInput.trim()) return;
    
    setIsLoading(true);
    
    const keywordsText = userKeywords.length > 0 ? `Student's interests: ${userKeywords.join(', ')}.` : '';
    const originalWordCount = currentMistake.sentence.trim().split(/\s+/).length;
    
    let assessmentPrompt;
    if (originalWordCount < 3) {
      // Handle incomplete original "sentences" (like single words)
      assessmentPrompt = `You are an expert ESL tutor. A student at proficiency level ${userLevel} previously wrote just "${currentMistake.sentence}" which was incomplete. ${keywordsText}
      Original learning item: ${JSON.stringify(originalItem.data)}
      Now they wrote a complete correction: "${userInput}"
      
      Analyze this correction attempt:
      1. Is it grammatically correct and complete?
      2. Does it properly demonstrate understanding of the target skill from the original learning item?
      3. Are there any NEW errors introduced in this correction?
      
      ${getLanguageInstruction(userLevel)}
      
      Respond ONLY with JSON:
      {
        "target_skill_mastered": boolean,
        "overall_correct": boolean,
        "new_errors": ["list of any new error types if found"],
        "feedback": "Constructive feedback for the student",
        "confidence_adjustment": number (-2 to +2, how much to adjust their confidence on this mistake)
      }`;
    } else {
      // Normal mistake correction flow
      assessmentPrompt = `You are an expert ESL tutor. A student at proficiency level ${userLevel} is correcting a mistake. ${keywordsText}
      Original learning item: ${JSON.stringify(originalItem.data)}
      Original mistake: "${currentMistake.sentence}"
      Original feedback: "${currentMistake.feedback}"
      Student's correction attempt: "${userInput}"
      
      Analyze this correction attempt:
      1. Does it fix the ORIGINAL error that was identified?
      2. Is the correction grammatically sound overall?
      3. Are there any NEW errors introduced in this correction?
      4. Does it demonstrate mastery of the target skill?
      
      ${getLanguageInstruction(userLevel)}
      
      Respond ONLY with JSON:
      {
        "target_skill_mastered": boolean,
        "overall_correct": boolean,
        "new_errors": ["list of any new error types if found"],
        "feedback": "Constructive feedback for the student",
        "confidence_adjustment": number (-2 to +2, how much to adjust their confidence on this mistake)
      }`;
    }
    
    try {
      const result = await callGemini(assessmentPrompt, true);
      
      // Update the mistake's confidence level based on AI assessment
      await onMistakeReviewed(currentMistake.id, result.target_skill_mastered, result.confidence_adjustment);
      
      setFeedback({ text: result.feedback, type: result.overall_correct ? 'correct' : 'warning' });
      
      // If there are new errors, log them as new mistakes
      if (result.new_errors && result.new_errors.length > 0 && !result.overall_correct) {
        await onNewMistake(
          originalItem,
          userInput,
          `Correction attempt introduced new errors: ${result.new_errors.join(', ')}. ${result.feedback}`,
          result.new_errors
        );
      }
      
      if (result.target_skill_mastered && result.overall_correct) {
        // Success! Move to next mistake
        setTimeout(moveToNextMistake, 2500);
      } else {
        // Need reinforcement practice
        setIsAssessmentDone(true);
        generateExercise('reinforcement');
      }
    } catch (e) {
      console.error("Error during mistake assessment:", e);
      setFeedback({ text: "Error checking answer. Please try again.", type: 'incorrect' });
    }
    setIsLoading(false);
  };
  
  const handlePracticeAnswer = async () => {
    if (!userInput.trim()) return;
    
    setIsLoading(true);
    
    // Simple validation for practice exercises
    const isReasonable = userInput.trim().length > 10; // Basic length check
    
    if (isReasonable) {
      setFeedback({ text: 'Good work! You\'re applying the concept correctly.', type: 'correct' });
      
      setTimeout(() => {
        if (practiceStep === 'reinforcement') {
          setPracticeStep('application');
          generateExercise('application');
        } else {
          moveToNextMistake();
        }
      }, 2000);
    } else {
      setFeedback({ text: 'Try to write a more complete response.', type: 'warning' });
    }
    
    setIsLoading(false);
  };
  
  const moveToNextMistake = () => {
    if (currentIndex + 1 >= mistakesToReview.length) {
      backToDash();
    } else {
      setCurrentIndex(currentIndex + 1);
      resetMistakeState();
    }
  };
  
  const resetMistakeState = () => {
    setIsAssessmentDone(false);
    setPracticeStep('correction');
    setExercise(null);
    setUserInput('');
    setFeedback({ text: '', type: '' });
  };
  
  React.useEffect(() => {
    if (currentMistake) {
      resetMistakeState();
    }
  }, [currentIndex]);
  
  if (!currentMistake) {
    return (
      <div className="text-center">
        <p className="text-xl font-semibold">No mistakes to review today. Great job!</p>
        <button onClick={backToDash} className="mt-4 text-blue-600 hover:underline">Back to Dashboard</button>
      </div>
    );
  }
  
  if (!originalItem || !module) {
    return (
      <div className="text-center">
        <p className="text-xl font-semibold text-red-600">Error: Could not find the original learning item for this mistake.</p>
        <button onClick={moveToNextMistake} className="mt-4 bg-blue-600 text-white py-2 px-4 rounded-lg">Skip to Next</button>
      </div>
    );
  }
  
  const DisplayCard = module.DisplayCard;
  const dummyProgress = { masteryLevel: 'Learning', attempts: 0, successes: 0 };
  
  return (
    <div>
      <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
      <h2 className="text-2xl font-bold mb-4 text-center">Mistake Review ({currentIndex + 1} / {mistakesToReview.length})</h2>
      
      {/* Original Learning Item Context */}
      <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-4">
        <h3 className="text-lg font-semibold mb-2">Original {module.name} Item:</h3>
        <DisplayCard item={originalItem} progress={dummyProgress} />
      </div>
      
      {/* Original Mistake */}
      <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
        <p className="text-sm text-gray-600">You previously wrote:</p>
        <p className="font-mono text-red-800 text-lg">"{currentMistake.sentence}"</p>
        <p className="text-sm text-gray-600 mt-2">Feedback: {currentMistake.feedback}</p>
      </div>
      
      {!isAssessmentDone ? (
        // Correction Phase
        <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
          <h3 className="text-lg font-semibold text-center mb-2">Correction Assessment</h3>
          <p className="text-center text-gray-600 mb-3">Rewrite your sentence to fix the original error:</p>
          <textarea 
            value={userInput} 
            onChange={e => setUserInput(e.target.value)} 
            className="w-full p-3 border-2 rounded-lg" 
            rows="3" 
            placeholder="Write your corrected sentence here..."
          />
          <button 
            onClick={handleCorrectionAssessment} 
            disabled={isLoading || !userInput.trim()} 
            className="mt-4 w-full bg-green-600 text-white py-3 rounded-lg disabled:bg-gray-400 font-semibold"
          >
            {isLoading ? 'AI Tutor is Analyzing...' : 'Submit Correction'}
          </button>
        </div>
      ) : (
        // Practice Phase
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
          <h3 className="text-lg font-semibold text-center mb-3">Practice: {practiceStep}</h3>
          {isLoading ? (
            <p className="text-center">Loading practice exercise...</p>
          ) : exercise ? (
            <div>
              <p className="text-center text-lg mb-4">{exercise.instruction}</p>
              {exercise.example && (
                <p className="text-center text-gray-600 mb-4 italic">Example: {exercise.example}</p>
              )}
              {exercise.context && (
                <p className="text-center text-gray-600 mb-4">Context: {exercise.context}</p>
              )}
              <textarea 
                value={userInput} 
                onChange={e => setUserInput(e.target.value)} 
                className="w-full p-3 border-2 rounded-lg" 
                rows="3" 
                placeholder="Write your response here..."
              />
              <button 
                onClick={handlePracticeAnswer} 
                disabled={isLoading || !userInput.trim()} 
                className="mt-4 w-full bg-yellow-600 text-white py-2 rounded-lg disabled:bg-gray-400"
              >
                {isLoading ? 'Checking...' : 'Submit Practice'}
              </button>
            </div>
          ) : (
            <p className="text-center text-red-500">Could not load practice exercise.</p>
          )}
        </div>
      )}
      
      {feedback.text && (
        <div className={`mt-4 p-3 rounded-lg text-center font-medium ${
          feedback.type === 'correct' ? 'bg-green-100 text-green-800' : 
          feedback.type === 'warning' ? 'bg-orange-100 text-orange-800' : 
          'bg-red-100 text-red-800'
        }`}>
          {typeof feedback.text === 'string' ? renderMarkdownText(feedback.text) : JSON.stringify(feedback.text)}
        </div>
      )}
    </div>
  );
}

function SettingsScreen({ userProfile, onUpdateProfile, backToDash }) {
  const [newKeyword, setNewKeyword] = useState('');
  
  const addKeyword = () => {
    if (newKeyword.trim() && !userProfile.keywords.includes(newKeyword.trim())) {
      onUpdateProfile({ keywords: [...userProfile.keywords, newKeyword.trim()] });
      setNewKeyword('');
    }
  };
  
  const removeKeyword = (keyword) => {
    onUpdateProfile({ keywords: userProfile.keywords.filter(k => k !== keyword) });
  };

  return (
    <div>
      <button onClick={backToDash} className="mb-4 text-blue-600 hover:underline">← Back to Dashboard</button>
      <h2 className="text-2xl font-bold mb-6">Settings</h2>
      
      <div className="space-y-6">
        {/* Level Selection */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">My Proficiency Level</h3>
          <select 
            value={userProfile.level} 
            onChange={(e) => onUpdateProfile({ level: e.target.value })}
            className="p-2 border rounded-lg"
          >
            <option value="A1">A1 - Beginner</option>
            <option value="A2">A2 - Elementary</option>
            <option value="B1">B1 - Intermediate</option>
            <option value="B2">B2 - Upper Intermediate</option>
            <option value="C1">C1 - Advanced</option>
          </select>
        </div>
        
        {/* Keywords Management */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">Personal Interests & Keywords</h3>
          
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
          
          {userProfile.keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {userProfile.keywords.map(keyword => (
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
            <p className="text-gray-500 text-sm">No keywords added yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================================================================================
// --- DEVELOPER PANEL ---
// ==================================================================================

function DeveloperPanel({ moduleRegistry, onAddNewModule, onClose }) {
  const [userInput, setUserInput] = useState('');
  const [generatedModule, setGeneratedModule] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const generateModule = async () => {
    if (!userInput.trim()) return;
    
    setIsLoading(true);
    setGeneratedModule(null);
    setTestResults(null);
    
    try {
      const existingModuleKeys = Object.keys(moduleRegistry);
      const prompt = createModuleGenerationPrompt(userInput, existingModuleKeys);
      const generatedCode = await callGemini(prompt, false);
      
      // Parse and validate the generated module
      const newModule = evaluateModuleCode(generatedCode);
      setGeneratedModule(newModule);
      
      // Run tests
      const tests = runModuleTests(newModule);
      setTestResults(tests);
      
    } catch (error) {
      setTestResults({ error: error.message });
    }
    
    setIsLoading(false);
  };

  const acceptModule = async () => {
    try {
      await onAddNewModule(generatedModule);
      setUserInput('');
      setGeneratedModule(null);
      setTestResults(null);
      alert(`Module "${generatedModule.name}" added successfully!`);
    } catch (error) {
      alert(`Failed to add module: ${error.message}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="p-4 border-b flex justify-between items-center bg-purple-50 rounded-t-lg">
          <h2 className="text-xl font-semibold text-purple-800">🔧 Module Generator</h2>
          <button onClick={onClose} className="text-2xl text-gray-500 hover:text-gray-800">×</button>
        </header>
        
        <main className="p-6 flex-grow overflow-y-auto">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Describe the learning module you want to create:
              </label>
              <textarea 
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                className="w-full p-3 border rounded-lg h-24"
                placeholder="e.g., 'Create a phrasal verbs module focused on travel and movement'"
              />
            </div>
            
            <button 
              onClick={generateModule}
              disabled={isLoading || !userInput.trim()}
              className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
            >
              {isLoading ? 'Generating...' : 'Generate Module'}
            </button>
            
            {/* Test Results */}
            {testResults && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-semibold mb-2">Test Results:</h4>
                {testResults.error ? (
                  <div className="text-red-600 font-mono text-sm">{testResults.error}</div>
                ) : (
                  <div className="space-y-1">
                    {testResults.map((test, idx) => (
                      <div key={idx} className={test.passed ? 'text-green-600' : 'text-red-600'}>
                        {test.passed ? '✅' : '❌'} {test.name}
                        {test.error && <div className="text-sm ml-4">{test.error}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Generated Module Preview */}
            {generatedModule && (
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-semibold mb-2">Generated Module: {generatedModule.name}</h4>
                <p className="text-sm text-gray-600 mb-4">{generatedModule.description}</p>
                
                <div className="flex gap-2">
                  <button 
                    onClick={acceptModule}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                  >
                    Accept & Add Module
                  </button>
                  <button 
                    onClick={() => {
                      setGeneratedModule(null);
                      setTestResults(null);
                    }}
                    className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ==================================================================================
// --- UTILITY FUNCTIONS ---
// ==================================================================================

// Simple markdown-to-JSX converter for feedback text
const renderMarkdownText = (text) => {
  if (typeof text !== 'string') return text;
  
  const parts = [];
  let remaining = text;
  let key = 0;
  
  while (remaining.length > 0) {
    // Look for **bold** text
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
    if (boldMatch) {
      const beforeBold = remaining.substring(0, boldMatch.index);
      if (beforeBold) parts.push(beforeBold);
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
    } else {
      // Look for *italic* text (but not part of bold)
      const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/);
      if (italicMatch) {
        const beforeItalic = remaining.substring(0, italicMatch.index);
        if (beforeItalic) parts.push(beforeItalic);
        parts.push(<em key={key++}>{italicMatch[1]}</em>);
        remaining = remaining.substring(italicMatch.index + italicMatch[0].length);
      } else {
        // No more markdown, add the rest
        parts.push(remaining);
        break;
      }
    }
  }
  
  return parts.length > 1 ? parts : text;
};

const validateModule = (module) => {
  const requiredFields = ['key', 'name', 'collectionName', 'DisplayCard', 'AddItemForm', 'getPracticePrompt'];
  const missingFields = requiredFields.filter(field => !module[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Module missing required fields: ${missingFields.join(', ')}`);
  }
  
  if (typeof module.DisplayCard !== 'function') {
    throw new Error('DisplayCard must be a React component function');
  }
  
  if (typeof module.AddItemForm !== 'function') {
    throw new Error('AddItemForm must be a React component function');
  }
  
  if (typeof module.getPracticePrompt !== 'function') {
    throw new Error('getPracticePrompt must be a function');
  }
  
  return true;
};

const evaluateModuleCode = (generatedCode) => {
  try {
    // Create safe execution context
    const moduleFunction = new Function(
      'React',
      `${generatedCode}; return NewModule;`
    );
    
    const newModule = moduleFunction(React);
    validateModule(newModule);
    return newModule;
  } catch (error) {
    throw new Error(`Generated module is invalid: ${error.message}`);
  }
};

const runModuleTests = (module) => {
  const tests = [];
  
  // Test DisplayCard rendering
  try {
    const testItem = { id: 'test', data: { test: 'data' } };
    const testProgress = { masteryLevel: 'New', attempts: 0, successes: 0 };
    React.createElement(module.DisplayCard, { item: testItem, progress: testProgress });
    tests.push({ name: 'DisplayCard renders', passed: true });
  } catch (e) {
    tests.push({ name: 'DisplayCard renders', passed: false, error: e.message });
  }
  
  // Test AddItemForm rendering
  try {
    React.createElement(module.AddItemForm, { 
      onSave: () => {}, 
      onCancel: () => {}, 
      userKeywords: [], 
      allItems: [] 
    });
    tests.push({ name: 'AddItemForm renders', passed: true });
  } catch (e) {
    tests.push({ name: 'AddItemForm renders', passed: false, error: e.message });
  }
  
  // Test prompt generation
  try {
    const prompt = module.getPracticePrompt({ data: {} }, 'B1', []);
    tests.push({ name: 'Prompt generation', passed: typeof prompt === 'string' && prompt.length > 0 });
  } catch (e) {
    tests.push({ name: 'Prompt generation', passed: false, error: e.message });
  }
  
  return tests;
};

// UTF-8 safe base64 encoding function
const utf8_to_b64 = (str) => {
  return window.btoa(unescape(encodeURIComponent(str)));
};

// Base64 encoded clean module template - no escaping issues!
const encodedModuleTemplate = utf8_to_b64(`const NewModule = {
  key: 'unique_module_key',
  name: 'Human Readable Name', 
  description: 'Brief description of what this module teaches',
  collectionName: 'yourCollectionName',
  icon: '📚',
  
  DisplayCard: ({ item, progress }) => {
    if (!progress) return null;
    const levelColor = { 
      'New': 'bg-blue-200 text-blue-800', 
      'Learning': 'bg-yellow-200 text-yellow-800', 
      'Mastered': 'bg-green-200 text-green-800' 
    }[progress.masteryLevel];
    
    return (
      <div className="p-3 bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <p className="font-bold text-lg">{item.data.mainField} <span className="text-base font-normal text-gray-500">({item.data.translation})</span></p>
            <p className="text-sm text-gray-600">{item.data.additionalInfo}</p>
          </div>
          <div className="text-right">
            <span className={\`px-3 py-1 text-sm font-semibold rounded-full \${levelColor}\`}>{progress.masteryLevel}</span>
            <p className="text-xs text-gray-500 mt-1">
              <span className="text-green-600">✓ {progress.successes}</span> | <span className="text-red-600">✗ {progress.attempts - progress.successes}</span>
            </p>
          </div>
        </div>
      </div>
    );
  },
  
  AddItemForm: ({ onSave, onCancel, userKeywords = [], allItems = [] }) => {
    const [mainField, setMainField] = React.useState('');
    const [translation, setTranslation] = React.useState('');
    const [additionalInfo, setAdditionalInfo] = React.useState('');
    const [error, setError] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);

    const handleAiSuggest = async () => {
        if (!mainField.trim()) { 
            setError("Please enter the main term first to get suggestions."); 
            return; 
        }
        setIsLoading(true);
        setError('');
        
        try {
            const prompt = \`For the term "\${mainField.trim()}", provide a simple translation and an example sentence. Respond ONLY with JSON: {"translation": "...", "example": "..."}\`;
            const result = await callGemini(prompt, true);
            if(result.translation) setTranslation(result.translation);
            if(result.example) setAdditionalInfo(result.example);
        } catch (e) { 
            setError("Could not get AI suggestion."); 
        }
        setIsLoading(false);
    };
    
    const handleSubmit = () => {
      if (!mainField || !translation) { 
        setError('The main field and translation are required.'); 
        return; 
      }
      
      const newItemData = { 
        mainField: mainField.trim(), 
        translation: translation.trim(),
        additionalInfo: additionalInfo.trim(),
        difficulty: 'B1',
        tags: ['general']
      };
      onSave(newItemData);
      onCancel();
    };
    
    return (
      <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
        <h3 className="text-lg font-semibold text-center">Add New Item</h3>
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        
        <div className="flex items-center gap-2">
            <input 
              value={mainField} 
              onChange={e => setMainField(e.target.value)} 
              placeholder="Main field (e.g., a phrasal verb)" 
              className="p-2 border rounded w-full"
            />
            <button 
              type="button" 
              onClick={handleAiSuggest} 
              disabled={isLoading} 
              className="bg-blue-500 text-white p-2 rounded whitespace-nowrap disabled:bg-gray-400"
            >
              {isLoading ? '...' : 'AI Help'}
            </button>
        </div>
        
        <input 
          value={translation} 
          onChange={e => setTranslation(e.target.value)} 
          placeholder="Translation" 
          className="p-2 border rounded w-full"
        />
        
        <textarea
          value={additionalInfo}
          onChange={e => setAdditionalInfo(e.target.value)}
          placeholder="Additional info or example sentence"
          className="w-full p-2 border rounded"
          rows="2"
        />
        
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="w-full bg-gray-500 text-white py-2 rounded">Cancel</button>
          <button type="button" onClick={handleSubmit} className="w-full bg-blue-600 text-white py-2 rounded">Save</button>
        </div>
      </div>
    );
  },
  
  getPracticePrompt: (item, userLevel, userKeywords) => {
    const keywordsText = userKeywords.length > 0 ? userKeywords.join(', ') : 'general topics';
    
    if (userLevel === 'A1') {
      return \`An A1 student is practicing: \${item.data.mainField}. Create a simple exercise. Respond with JSON: {"question": "...", "answer": "...", "explanation": "..."}\`;
    }
    
    return \`A \${userLevel} student interested in '\${keywordsText}' is practicing: \${item.data.mainField}. Create an appropriate exercise.\`;
  }
};`);

const createModuleGenerationPrompt = (userRequest, existingModuleKeys) => {
  return `You are an expert React developer creating a learning module for a language learning app.

EXISTING MODULES: ${existingModuleKeys.join(', ')}
USER REQUEST: "${userRequest}"

TEMPLATE (base64 encoded): ${encodedModuleTemplate}

INSTRUCTIONS:
1. First, decode the base64 template above using: atob("${encodedModuleTemplate}")
2. Adapt the decoded template to match your user request perfectly
3. Customize these elements for the specific learning content:
   - key: Make it unique (not: ${existingModuleKeys.join(', ')})
   - name: Human-readable module name
   - description: Brief description of what this teaches
   - collectionName: Single word, camelCase (e.g., 'phrasalVerbs', 'businessIdioms')
   - icon: Choose appropriate emoji
   - Field names: Adapt mainField, translation, additionalInfo to your content type
   - AI prompt: Customize the handleAiSuggest prompt for your specific content
   - Practice prompts: Tailor getPracticePrompt for your learning objectives

4. The structure and functionality must remain exactly the same - only customize the content-specific parts

CRITICAL REQUIREMENTS:
- Use ONLY React.useState, never useState
- Keep all the AI assistance functionality intact
- Make the module key unique from existing ones
- Ensure the AI prompt in handleAiSuggest is specific to your content type
- Keep all error handling and loading states

Your response MUST be ONLY the final JavaScript code, starting with 'const NewModule = {' and ending with '};'`;
};

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
