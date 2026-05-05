import React, { useState } from 'react';
import { Assessment, Question, AISettings } from '../types';
import { Plus, Trash2, CheckCircle2, XCircle, Bot, Loader2 } from 'lucide-react';
import { generateDistractors } from '../services/geminiService';

interface AssessmentEditorProps {
  assessment: Assessment;
  onChange: (data: Assessment) => void;
  aiSettings: AISettings;
  contextText: string; // To provide context to the distractor generator
}

export const AssessmentEditor: React.FC<AssessmentEditorProps> = ({ assessment, onChange, aiSettings, contextText }) => {
  const [loadingQ, setLoadingQ] = useState<string | null>(null);

  const addQuestion = () => {
    const newQ: Question = {
      id: `q-${Date.now()}`,
      type: 'multiple-choice',
      question: 'New Question',
      correctAnswer: '',
      options: ['Option 1', 'Option 2'],
      feedback: { correct: 'Correct!', incorrect: 'Try again.' }
    };
    onChange({ ...assessment, questions: [...assessment.questions, newQ] });
  };

  const updateQuestion = (index: number, q: Question) => {
    const newQuestions = [...assessment.questions];
    newQuestions[index] = q;
    onChange({ ...assessment, questions: newQuestions });
  };

  const removeQuestion = (index: number) => {
    const newQuestions = assessment.questions.filter((_, i) => i !== index);
    onChange({ ...assessment, questions: newQuestions });
  };

  const handleGenerateDistractors = async (index: number, q: Question) => {
    if (!q.question || !q.correctAnswer) {
        alert("Please enter a question and a correct answer first.");
        return;
    }
    
    setLoadingQ(q.id);
    try {
        const distractors = await generateDistractors(aiSettings, q.question, q.correctAnswer, contextText);
        // Ensure we don't duplicate the correct answer if it happened to be generated
        const uniqueDistractors = distractors.filter(d => d.toLowerCase() !== q.correctAnswer.toLowerCase());
        
        // Combine correct answer (ensuring it's in the list) + distractors
        // Note: The UI logic below treats 'options' as the full list including the correct answer
        const newOptions = [q.correctAnswer, ...uniqueDistractors.slice(0, 3)];
        
        // Shuffle slightly
        newOptions.sort(() => Math.random() - 0.5);

        updateQuestion(index, { ...q, options: newOptions });
    } catch (e) {
        alert("Failed to generate distractors.");
    } finally {
        setLoadingQ(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 flex justify-between items-center">
        <div>
           <h2 className="text-xl font-bold text-slate-800">Assessment Engine</h2>
           <p className="text-slate-500 text-sm">Configure passing criteria and question bank.</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-slate-700">Pass Mark (%)</label>
          <input 
            type="number" 
            value={assessment.passMark}
            onChange={(e) => onChange({ ...assessment, passMark: parseInt(e.target.value) || 0 })}
            className="w-20 p-2 bg-white text-slate-900 border border-slate-300 rounded text-center"
          />
        </div>
      </div>

      <div className="space-y-6">
        {assessment.questions.map((q, idx) => (
          <div key={q.id} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
              <span className="font-semibold text-slate-700">Question {idx + 1}</span>
              <div className="flex items-center gap-3">
                <select 
                  value={q.type}
                  onChange={(e) => updateQuestion(idx, { ...q, type: e.target.value as any })}
                  className="text-sm border-slate-300 rounded px-2 py-1 bg-white text-slate-900 border"
                >
                  <option value="multiple-choice">Multiple Choice</option>
                  <option value="true-false">True / False</option>
                </select>
                <button onClick={() => removeQuestion(idx)} className="text-red-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Question Text</label>
                <input 
                  type="text" 
                  value={q.question}
                  onChange={(e) => updateQuestion(idx, { ...q, question: e.target.value })}
                  className="w-full p-2 bg-white text-slate-900 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                />
              </div>

              {q.type === 'multiple-choice' && (
                <div>
                   <div className="flex justify-between items-end mb-2">
                       <label className="block text-xs font-bold text-slate-500 uppercase">Options</label>
                       <button
                         onClick={() => handleGenerateDistractors(idx, q)}
                         disabled={loadingQ === q.id}
                         className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded border border-purple-200 hover:bg-purple-100 flex items-center gap-1 transition-colors"
                       >
                         {loadingQ === q.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <Bot className="w-3 h-3"/>}
                         Auto-Generate Distractors
                       </button>
                   </div>
                   <div className="space-y-2">
                     {q.options?.map((opt, optIdx) => (
                       <div key={optIdx} className="flex items-center gap-2">
                         <div className={`w-4 h-4 rounded-full border ${q.correctAnswer === opt ? 'bg-green-500 border-green-500' : 'border-slate-300'}`} />
                         <input 
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const newOpts = [...(q.options || [])];
                              newOpts[optIdx] = e.target.value;
                              updateQuestion(idx, { ...q, options: newOpts });
                            }}
                            className="flex-1 p-2 bg-white text-slate-900 border border-slate-200 rounded text-sm"
                         />
                         <button 
                           onClick={() => updateQuestion(idx, { ...q, correctAnswer: opt })}
                           className="text-xs text-green-600 hover:underline whitespace-nowrap"
                         >
                           Set Correct
                         </button>
                         <button 
                            onClick={() => {
                                const newOpts = q.options?.filter((_, i) => i !== optIdx);
                                updateQuestion(idx, { ...q, options: newOpts });
                            }}
                            className="text-slate-400 hover:text-red-500"
                         >
                            <Trash2 className="w-3 h-3" />
                         </button>
                       </div>
                     ))}
                     <button 
                        onClick={() => updateQuestion(idx, { ...q, options: [...(q.options || []), "New Option"] })}
                        className="text-sm text-blue-600 flex items-center gap-1 mt-2"
                     >
                       <Plus className="w-3 h-3" /> Add Option
                     </button>
                   </div>
                </div>
              )}

              {q.type === 'true-false' && (
                <div className="flex gap-4">
                    <button 
                      onClick={() => updateQuestion(idx, { ...q, correctAnswer: 'true' })}
                      className={`px-4 py-2 rounded border ${q.correctAnswer === 'true' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white text-slate-700 border-slate-200'}`}
                    >
                      True
                    </button>
                    <button 
                      onClick={() => updateQuestion(idx, { ...q, correctAnswer: 'false' })}
                      className={`px-4 py-2 rounded border ${q.correctAnswer === 'false' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white text-slate-700 border-slate-200'}`}
                    >
                      False
                    </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mt-4 bg-slate-50 p-4 rounded border border-slate-100">
                <div>
                   <label className="flex items-center gap-1 text-xs font-bold text-green-600 uppercase mb-1">
                     <CheckCircle2 className="w-3 h-3" /> Correct Feedback
                   </label>
                   <textarea 
                     value={q.feedback.correct}
                     onChange={(e) => updateQuestion(idx, { ...q, feedback: { ...q.feedback, correct: e.target.value } })}
                     className="w-full p-2 bg-white text-slate-900 border border-green-200 rounded text-sm focus:outline-none focus:border-green-400"
                     rows={2}
                   />
                </div>
                <div>
                   <label className="flex items-center gap-1 text-xs font-bold text-red-600 uppercase mb-1">
                     <XCircle className="w-3 h-3" /> Incorrect Feedback
                   </label>
                   <textarea 
                     value={q.feedback.incorrect}
                     onChange={(e) => updateQuestion(idx, { ...q, feedback: { ...q.feedback, incorrect: e.target.value } })}
                     className="w-full p-2 bg-white text-slate-900 border border-red-200 rounded text-sm focus:outline-none focus:border-red-400"
                     rows={2}
                   />
                </div>
              </div>

            </div>
          </div>
        ))}
        
        <button 
          onClick={addQuestion}
          className="w-full py-4 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add New Question
        </button>
      </div>
    </div>
  );
};
