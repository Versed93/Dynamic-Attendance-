
import React, { useState, useEffect } from 'react';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { QrCodeIcon } from './icons/QrCodeIcon';
import { ClockIcon } from './icons/ClockIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

interface StudentViewProps {
  markAttendance: (name: string, studentId: string, email: string) => { success: boolean, message: string };
  token: string;
  bypassRestrictions?: boolean;
  onExit?: () => void;
}

type Status = 'validating' | 'form' | 'success' | 'error' | 'cooldown';

const COOLDOWN_MINUTES = 30;
const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;
const LAST_SCAN_KEY = 'attendance-last-scan-standard-v1';
const LOGO_URL = "https://upload.wikimedia.org/wikipedia/en/2/23/University_of_Technology_Sarawak_Logo.png";

export const StudentView: React.FC<StudentViewProps> = ({ markAttendance, token, bypassRestrictions = false, onExit }) => {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [isNewStudent, setIsNewStudent] = useState(false);
  
  // Start in validating mode
  const [status, setStatus] = useState<Status>('validating');
  
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  
  // Cooldown specific state
  const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(null);
  const [remainingTime, setRemainingTime] = useState<string>('');
  
  // Validate Token on Mount
  useEffect(() => {
    // If Admin/Kiosk mode, bypass validation logic
    if (bypassRestrictions) {
        setStatus('form');
        return;
    }

    if (!token) {
        setStatus('error');
        setMessage('Invalid link. Please scan the QR code again.');
        return;
    }

    const qrTime = parseInt(token, 10);
    const now = Date.now();
    // Allow 60 seconds for the student to scan, open the link, and for the page to load.
    const isValid = !isNaN(qrTime) && (now - qrTime < 60000); 

    if (isValid) {
        // Check for device cooldown to prevent cheating
        const lastScanStr = localStorage.getItem(LAST_SCAN_KEY);
        if (lastScanStr) {
            const lastScanTime = parseInt(lastScanStr, 10);
            const timeDiff = now - lastScanTime;
            
            if (timeDiff < COOLDOWN_MS) {
                const targetTime = lastScanTime + COOLDOWN_MS;
                setCooldownEndTime(targetTime);
                setStatus('cooldown');
                return;
            }
        }
        setStatus('form');
    } else {
        setStatus('error');
        setMessage('This QR code has expired. Please refresh the teacher\'s screen and scan the new code.');
    }
  }, [token, bypassRestrictions]);

  // Countdown Timer Effect
  useEffect(() => {
    if (status !== 'cooldown' || !cooldownEndTime) return;

    const interval = setInterval(() => {
        const now = Date.now();
        const diff = cooldownEndTime - now;

        if (diff <= 0) {
            setStatus('form');
            setCooldownEndTime(null);
            clearInterval(interval);
        } else {
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            setRemainingTime(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        }
    }, 1000);

    return () => clearInterval(interval);
  }, [status, cooldownEndTime]);
  
  const validateForm = (): boolean => {
    if (!name.trim() || !studentId.trim() || !email.trim()) {
      setFormError('All fields are required.');
      return false;
    }

    // Validate Student ID Format: 3 Letters + 8 Numbers (e.g., FIA24001006)
    const studentIdRegex = /^[A-Z]{3}\d{8}$/;
    if (!studentIdRegex.test(studentId)) {
        setFormError('Invalid Student ID. It must be exactly 3 letters followed by 8 numbers (e.g., FIA24001006).');
        return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setFormError('Please enter a valid email address.');
      return false;
    }
    setFormError('');
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      const result = markAttendance(name, studentId, email);
      if (result.success) {
        // Only enforce cooldown if NOT in bypass/admin mode
        if (!bypassRestrictions) {
            localStorage.setItem(LAST_SCAN_KEY, Date.now().toString());
        }
        setStatus('success');
      } else {
        setStatus('error');
      }
      setMessage(result.message);
    }
  };

  const handleReset = () => {
    setName('');
    setStudentId('');
    setEmail('');
    setIsNewStudent(false);
    setStatus('form');
    setMessage('');
    setFormError('');
  };

  // Helper to handle input changes with uppercase enforcement
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setName(e.target.value.toUpperCase());
  };
  
  const handleStudentIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Allow user to type, but force uppercase
      const val = e.target.value.toUpperCase();
      setStudentId(val);

      // Check if ID matches pre-registered list
      const matchedStudent = PRE_REGISTERED_STUDENTS.find(s => s.id === val);
      
      if (matchedStudent) {
          setName(matchedStudent.name);
          setIsNewStudent(false);
      } else {
          // Only clear name if we previously auto-filled it and user is changing ID
          // We check !isNewStudent because if it was ALREADY true (manual entry),
          // we don't want to clear what the user typed just because they changed the ID.
          if (!isNewStudent && name) {
              setName('');
          }
          setIsNewStudent(true);
      }

      // Auto-fill email if ID format is valid
      const studentIdRegex = /^[A-Z]{3}\d{8}$/;
      if (studentIdRegex.test(val)) {
        setEmail(`${val}@STUDENT.UTS.EDU.MY`);
        setFormError(''); // Clear potential previous errors
      }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setEmail(e.target.value.toUpperCase());
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
        {/* Admin/Kiosk Exit Button */}
        {bypassRestrictions && onExit && (
            <button 
                onClick={onExit}
                className="absolute -top-2 -right-2 text-xs text-gray-400 hover:text-gray-600 p-2"
                title="Exit Admin Mode"
            >
                ✕ Exit Admin
            </button>
        )}

        {status === 'cooldown' && (
            <div className="text-center px-4" role="alert">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-yellow-100 text-yellow-600 mb-4 animate-pulse">
                    <ClockIcon className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-bold text-yellow-700 mb-2">Device Limit Reached</h3>
                <p className="text-gray-600 mb-6 max-w-sm mx-auto">
                    To prevent misuse, this device is temporarily locked. You can scan again when the timer expires.
                </p>
                
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 max-w-xs mx-auto">
                    <p className="text-xs uppercase tracking-wide text-yellow-600 font-semibold mb-1">Next Scan In</p>
                    <div className="text-5xl font-mono font-bold text-yellow-800 tracking-wider">
                        {remainingTime}
                    </div>
                </div>
            </div>
        )}

        {status === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="text-center mb-4">
                    <div className="flex justify-center mb-4">
                        <img 
                            src={LOGO_URL} 
                            alt="UTS Logo" 
                            className="h-24 w-auto object-contain"
                        />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">
                        {bypassRestrictions ? 'Admin Mode' : 'Enter Details'}
                    </h3>
                    <p className="text-sm text-green-600 font-medium mt-1">
                        {bypassRestrictions ? 'Unrestricted Entry' : 'Link Verified Successfully'}
                    </p>
                </div>

                {isNewStudent && studentId.length >= 11 && (
                     <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800 mb-2">
                        <strong>New Registration:</strong> Your ID was not found in the class list. You can still register by filling in your name.
                     </div>
                )}
                
                {!isNewStudent && studentId.length >= 11 && name && (
                     <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800 mb-2">
                        <strong>Verified:</strong> Student ID found. Name auto-filled.
                     </div>
                )}

                <div>
                    <label htmlFor="studentId" className="block text-sm font-medium text-gray-700">Student ID</label>
                    <input
                    type="text"
                    id="studentId"
                    value={studentId}
                    placeholder="e.g., FIA24001006"
                    onChange={handleStudentIdChange}
                    className="mt-1 block w-full bg-base-100 border border-base-300 rounded-md shadow-sm py-2 px-3 text-gray-900 focus:outline-none focus:ring-brand-primary focus:border-brand-primary sm:text-sm uppercase"
                    />
                    <p className="text-xs text-gray-500 mt-1">Format: 3 Letters + 8 Numbers</p>
                </div>
                
                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700">Full Name</label>
                    <input
                    type="text"
                    id="name"
                    value={name}
                    placeholder="e.g., JAMES BOND"
                    onChange={handleNameChange}
                    // Disable name editing if found in database to ensure data integrity
                    readOnly={!isNewStudent && name.length > 0} 
                    className={`mt-1 block w-full border border-base-300 rounded-md shadow-sm py-2 px-3 text-gray-900 focus:outline-none focus:ring-brand-primary focus:border-brand-primary sm:text-sm uppercase ${!isNewStudent && name.length > 0 ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-base-100'}`}
                    />
                </div>
                
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email Address</label>
                    <input
                    type="email"
                    id="email"
                    value={email}
                    placeholder="e.g., FIA24001006@STUDENT.UTS.EDU.MY"
                    onChange={handleEmailChange}
                    className="mt-1 block w-full bg-base-100 border border-base-300 rounded-md shadow-sm py-2 px-3 text-gray-900 focus:outline-none focus:ring-brand-primary focus:border-brand-primary sm:text-sm uppercase"
                    />
                </div>
                {formError && <p className="text-sm text-red-500 font-medium">{formError}</p>}
                
                <button
                    type="submit"
                    className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-primary hover:bg-brand-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary disabled:bg-indigo-300 disabled:cursor-not-allowed"
                    >
                    <CheckCircleIcon className="w-5 h-5" />
                    Submit Attendance
                </button>
            </form>
        )}

        {(status === 'success' || status === 'error') && (
            <div className="text-center py-8" role="alert">
                {status === 'success' ? (
                    <div className="mx-auto flex items-center justify-center h-28 w-28 rounded-full bg-green-100 mb-6 shadow-sm">
                        <CheckCircleIcon className="h-16 w-16 text-green-600" />
                    </div>
                ) : (
                    <div className="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-red-100 mb-6">
                        <p className="text-5xl">😟</p>
                    </div>
                )}
                <h3 className={`text-3xl font-extrabold ${status === 'success' ? 'text-green-800' : 'text-red-600'} mb-2`}>
                    {status === 'success' ? 'Attendance Recorded!' : 'Submission Failed'}
                </h3>
                <p className="text-gray-600 text-lg mb-8 px-4 leading-relaxed">{message}</p>
                
                {status === 'success' ? (
                    <div className="max-w-xs mx-auto p-6 bg-green-50 rounded-xl border border-green-200 shadow-sm">
                        {bypassRestrictions ? (
                            <button
                                onClick={handleReset}
                                className="w-full py-3 px-4 border border-transparent rounded-lg shadow text-base font-bold text-white bg-brand-primary hover:bg-brand-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary transition-colors"
                            >
                                Register Next Student
                            </button>
                        ) : (
                            <div className="space-y-1">
                                <p className="text-green-800 font-bold text-lg">You're all set!</p>
                                <p className="text-green-700">You can safely close this window.</p>
                                <div className="mt-4 pt-4 border-t border-green-200">
                                    <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Device Cooldown Active</p>
                                    <p className="text-xs text-green-600 opacity-75">30 minutes</p>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">Contact the teacher if you believe this is an error.</p>
                )}
            </div>
        )}
    </div>
  );
};
