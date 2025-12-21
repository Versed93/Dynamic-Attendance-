
import React, { useState, useEffect } from 'react';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ClockIcon } from './icons/ClockIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

interface StudentViewProps {
  markAttendance: (name: string, studentId: string, email: string) => { success: boolean, message: string };
  token: string;
  bypassRestrictions?: boolean;
  onExit?: () => void;
  isSyncing?: boolean;
}

type Status = 'validating' | 'form' | 'success' | 'error' | 'cooldown';

const COOLDOWN_MINUTES = 30;
const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;
const LAST_SCAN_KEY = 'attendance-last-scan-standard-v1';

export const StudentView: React.FC<StudentViewProps> = ({ markAttendance, token, bypassRestrictions = false, onExit, isSyncing = false }) => {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [isNewStudent, setIsNewStudent] = useState(false);
  const [status, setStatus] = useState<Status>('validating');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(null);
  const [remainingTime, setRemainingTime] = useState<string>('');
  
  useEffect(() => {
    if (bypassRestrictions) { setStatus('form'); return; }
    if (!token) { setStatus('error'); setMessage('Invalid link. Please scan the QR code again.'); return; }
    const qrTime = parseInt(token, 10);
    const now = Date.now();
    const isValid = !isNaN(qrTime) && (now - qrTime < 60000); 
    if (isValid) {
        const lastScanStr = localStorage.getItem(LAST_SCAN_KEY);
        if (lastScanStr) {
            const lastScanTime = parseInt(lastScanStr, 10);
            const timeDiff = now - lastScanTime;
            if (timeDiff < COOLDOWN_MS) {
                setCooldownEndTime(lastScanTime + COOLDOWN_MS);
                setStatus('cooldown');
                return;
            }
        }
        setStatus('form');
    } else {
        setStatus('error');
        setMessage('This QR code has expired. Please scan the new code on the teacher\'s screen.');
    }
  }, [token, bypassRestrictions]);

  useEffect(() => {
    if (status !== 'cooldown' || !cooldownEndTime) return;
    const interval = setInterval(() => {
        const diff = cooldownEndTime - Date.now();
        if (diff <= 0) { setStatus('form'); setCooldownEndTime(null); clearInterval(interval); }
        else {
            const minutes = Math.floor((diff / 60000));
            const seconds = Math.floor((diff % 60000) / 1000);
            setRemainingTime(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        }
    }, 1000);
    return () => clearInterval(interval);
  }, [status, cooldownEndTime]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !studentId.trim() || !email.trim()) { setFormError('All fields required.'); return; }
    const studentIdRegex = /^[A-Z]{3}\d{8}$/;
    if (!studentIdRegex.test(studentId)) { setFormError('Invalid ID (e.g. FIA24001006).'); return; }
    
    const result = markAttendance(name, studentId, email);
    if (result.success) {
      if (!bypassRestrictions) localStorage.setItem(LAST_SCAN_KEY, Date.now().toString());
      setStatus('success');
    } else {
      setStatus('error');
    }
    setMessage(result.message);
  };

  const handleStudentIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.toUpperCase();
      setStudentId(val);
      const matched = PRE_REGISTERED_STUDENTS.find(s => s.id === val);
      if (matched) { setName(matched.name); setIsNewStudent(false); } 
      else { if (!isNewStudent && name) setName(''); setIsNewStudent(true); }
      if (/^[A-Z]{3}\d{8}$/.test(val)) setEmail(`${val}@STUDENT.UTS.EDU.MY`);
  };

  if (status === 'validating') {
      return (
        <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Verifying secure link...</p>
        </div>
      );
  }

  return (
    <div className="relative">
        {bypassRestrictions && onExit && (
            <button onClick={onExit} className="absolute -top-2 -right-2 text-xs text-gray-400 hover:text-gray-600 p-2">✕ Exit Admin</button>
        )}

        {status === 'cooldown' && (
            <div className="text-center px-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-yellow-100 text-yellow-600 mb-4 animate-pulse"><ClockIcon className="w-8 h-8" /></div>
                <h3 className="text-2xl font-bold text-yellow-700 mb-2">Device Limit</h3>
                <p className="text-gray-600 mb-6 max-w-sm mx-auto">This device is locked to prevent multiple entries. Next scan in:</p>
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 max-w-xs mx-auto">
                    <div className="text-5xl font-mono font-bold text-yellow-800 tracking-wider">{remainingTime}</div>
                </div>
            </div>
        )}

        {status === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="text-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">Check-in Details</h3>
                    <p className="text-sm text-green-600 font-medium mt-1">Verified Link</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Student ID</label>
                    <input type="text" value={studentId} placeholder="FIA24001006" onChange={handleStudentIdChange} className="mt-1 block w-full bg-base-100 border border-base-300 rounded-md py-2 px-3 text-gray-900 uppercase" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Full Name</label>
                    <input type="text" value={name} placeholder="JAMES BOND" onChange={(e) => setName(e.target.value.toUpperCase())} readOnly={!isNewStudent && name.length > 0} className={`mt-1 block w-full border border-base-300 rounded-md py-2 px-3 text-gray-900 uppercase ${!isNewStudent && name.length > 0 ? 'bg-gray-100 text-gray-500' : 'bg-base-100'}`} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Email Address</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value.toUpperCase())} className="mt-1 block w-full bg-base-100 border border-base-300 rounded-md py-2 px-3 text-gray-900 uppercase" />
                </div>
                {formError && <p className="text-sm text-red-500 font-medium">{formError}</p>}
                <button type="submit" className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-md shadow-sm text-base font-bold text-white bg-brand-primary hover:bg-brand-secondary">Submit Attendance</button>
            </form>
        )}

        {(status === 'success' || status === 'error') && (
            <div className="text-center py-8">
                <div className={`mx-auto flex items-center justify-center h-28 w-28 rounded-full ${status === 'success' ? 'bg-green-100' : 'bg-red-100'} mb-6 shadow-sm`}>
                    {status === 'success' ? (
                        isSyncing ? (
                            <div className="relative">
                                <ClockIcon className="h-16 w-16 text-brand-primary animate-pulse" />
                                <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 border border-brand-primary">
                                    <GlobeIcon className="w-4 h-4 text-brand-primary animate-spin" />
                                </div>
                            </div>
                        ) : (
                            <CheckCircleIcon className="h-16 w-16 text-green-600" />
                        )
                    ) : (
                        <p className="text-5xl">😟</p>
                    )}
                </div>

                <div className="mb-6">
                    <h3 className={`text-3xl font-extrabold ${status === 'success' ? (isSyncing ? 'text-brand-primary' : 'text-green-800') : 'text-red-600'} mb-2`}>
                        {status === 'success' ? (isSyncing ? 'Syncing...' : 'Verified!') : 'Failed'}
                    </h3>
                    
                    {status === 'success' && isSyncing && (
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-light/20 text-brand-primary rounded-full text-xs font-bold uppercase tracking-wider mb-4 border border-brand-light/30">
                            <ClockIcon className="w-3.5 h-3.5" />
                            Sending to Google
                        </div>
                    )}

                    <p className="text-gray-600 text-lg px-4 leading-relaxed">
                        {status === 'success' 
                          ? (isSyncing 
                              ? 'Saved to phone! Now uploading to the Google Sheet...' 
                              : 'Attendance recorded and verified in the cloud.') 
                          : message}
                    </p>
                </div>
                
                {status === 'success' && (
                    <div className={`max-w-sm mx-auto p-6 rounded-2xl border transition-all duration-500 ${isSyncing ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                        <p className={`font-bold text-lg mb-2 ${isSyncing ? 'text-orange-800' : 'text-green-800'}`}>
                            {isSyncing ? '⚠ DO NOT CLOSE THIS TAB' : 'Success!'}
                        </p>
                        <p className={`text-sm leading-relaxed ${isSyncing ? 'text-orange-700' : 'text-green-700'}`}>
                            {isSyncing 
                                ? 'Wait for the icon to turn GREEN. If the server is busy, we will automatically retry for you. Just wait.' 
                                : 'Your attendance has been permanently recorded in the official Google Sheet. You can safely close this tab now.'}
                        </p>
                        
                        {bypassRestrictions && !isSyncing && (
                             <button onClick={() => { setName(''); setStudentId(''); setEmail(''); setStatus('form'); }} className="mt-6 w-full py-3 bg-brand-primary text-white rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all">
                                Register Next Student
                             </button>
                        )}
                    </div>
                )}
            </div>
        )}
    </div>
  );
};
