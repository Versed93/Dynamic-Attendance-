
import React, { useState, useCallback, useEffect } from 'react';
import { TeacherView } from './components/TeacherView';
import { StudentView } from './components/StudentView';
import type { Student } from './types';

type View = 'teacher' | 'student';

const STORAGE_KEY = 'attendance-storage-standard-v1';
const DELETED_IDS_KEY = 'attendance-deleted-ids-v1';
const SCRIPT_URL_KEY = 'attendance-script-url-v21';
const SYNC_QUEUE_KEY = 'attendance-sync-queue-v2';

interface SyncTask {
  id: string;
  data: Record<string, string>;
  timestamp: number;
}

const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('t');
  const initialView: View = token ? 'student' : 'teacher';

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [attendanceList, setAttendanceList] = useState<Student[]>([]);
  
  const [locallyDeletedIds, setLocallyDeletedIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(DELETED_IDS_KEY);
    try {
        return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
        return new Set();
    }
  });
  
  const [scriptUrl, setScriptUrl] = useState<string>(() => {
    const saved = localStorage.getItem(SCRIPT_URL_KEY);
    // Use the latest URL provided by the user as default
    return saved || 'https://script.google.com/macros/s/AKfycbxhMDImDgH34jMpCuCKTl_iL3xxnZf9OzjXORqnULDOg02C64p3JArfT8xH4oX7RsmS/exec';
  });

  const [syncQueue, setSyncQueue] = useState<SyncTask[]>(() => {
      try {
          const saved = localStorage.getItem(SYNC_QUEUE_KEY);
          return saved ? JSON.parse(saved) : [];
      } catch (e) {
          return [];
      }
  });
  const [isSyncing, setIsSyncing] = useState(false);

  // Prevent closing tab if data hasn't synced
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (syncQueue.length > 0) {
        e.preventDefault();
        e.returnValue = 'Your attendance is still saving to the cloud. Please wait until the spinner stops.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [syncQueue]);

  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (Array.isArray(parsed)) setAttendanceList(parsed);
      } catch (e) {
        console.error('Failed to parse attendance data', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attendanceList));
  }, [attendanceList]);

  useEffect(() => {
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(locallyDeletedIds)));
  }, [locallyDeletedIds]);
  
  useEffect(() => {
    localStorage.setItem(SCRIPT_URL_KEY, scriptUrl);
  }, [scriptUrl]);

  useEffect(() => {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  }, [syncQueue]);

  // --- IMPROVED SYNC PROCESSOR FOR HIGH TRAFFIC ---
  useEffect(() => {
    if (syncQueue.length === 0 || isSyncing) return;
    if (!scriptUrl || !scriptUrl.startsWith('http')) return;

    let active = true;

    const processNext = async () => {
        setIsSyncing(true);
        const task = syncQueue[0];

        try {
            const formData = new URLSearchParams();
            Object.entries(task.data).forEach(([k, v]) => formData.append(k, String(v)));

            // Fetch with a timeout to prevent hanging connections
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000); // Increased timeout for server load

            const response = await fetch(scriptUrl.trim(), {
                method: 'POST',
                body: formData,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                // If 429 Too Many Requests or 500, we throw to trigger retry
                throw new Error(`Server status: ${response.status}`);
            }

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch(e) {
                throw new Error("Invalid server response format");
            }

            if (result.result !== 'success') {
                throw new Error(result.message || 'Script rejected data');
            }

            // SUCCESS
            if (active) setSyncQueue(prev => prev.filter(t => t.id !== task.id));

        } catch (err) {
            console.warn("Sync failed, retrying with exponential jitter...", err);
            
            // CRITICAL FOR 230 STUDENTS:
            // Google Apps Script can handle ~30 concurrent requests.
            // If 230 students fail initially, we need to spread their retries out significantly.
            // Wait between 5 seconds and 20 seconds.
            const jitter = 5000 + Math.random() * 15000;
            
            await new Promise(resolve => setTimeout(resolve, jitter));
        } finally {
            if (active) setIsSyncing(false);
        }
    };

    processNext();
    return () => { active = false; };
  }, [syncQueue, isSyncing, scriptUrl]);


  useEffect(() => {
    if (!scriptUrl || !scriptUrl.startsWith('http') || view === 'student') return;
    let isMounted = true;
    const fetchData = async () => {
      try {
        const response = await fetch(`${scriptUrl.trim()}?action=read&_=${Date.now()}`);
        if (!response.ok) return;
        const data = await response.json();
        if (isMounted && Array.isArray(data)) {
           setAttendanceList(prevList => {
               const mergedMap = new Map<string, Student>();
               prevList.forEach(s => { if (s.studentId) mergedMap.set(s.studentId.toUpperCase(), s); });
               (data as any[]).forEach((item: any) => {
                   if (!item.studentId) return;
                   const normalizedId = item.studentId.toUpperCase();
                   if (locallyDeletedIds.has(normalizedId)) return;
                   const existing = mergedMap.get(normalizedId);
                   mergedMap.set(normalizedId, {
                       name: item.name ? item.name.toUpperCase() : '',
                       studentId: normalizedId,
                       email: item.email ? item.email.toUpperCase() : '',
                       timestamp: existing ? existing.timestamp : (item.timestamp || Date.now()),
                       status: item.status || 'P',
                   });
               });
               return Array.from(mergedMap.values());
           });
        }
      } catch (e) { console.warn('Polling failed:', e); }
    };
    const interval = setInterval(fetchData, 6000);
    fetchData(); 
    return () => { isMounted = false; clearInterval(interval); };
  }, [scriptUrl, view, locallyDeletedIds]);

  const handleMarkAttendance = useCallback((name: string, studentId: string, email: string, status: 'P' | 'A' = 'P'): { success: boolean, message: string } => {
    const normalizedId = studentId.toUpperCase();
    setLocallyDeletedIds(prev => {
        if (prev.has(normalizedId)) {
            const next = new Set(prev);
            next.delete(normalizedId);
            return next;
        }
        return prev;
    });

    const newStudent: Student = { name, studentId: normalizedId, email, timestamp: Date.now(), status };
    setAttendanceList(prevList => {
        const filtered = prevList.filter(s => s.studentId.toUpperCase() !== normalizedId);
        return [newStudent, ...filtered];
    });
    
    if (scriptUrl && scriptUrl.startsWith('http')) {
        const task: SyncTask = {
            id: Math.random().toString(36).substring(2, 9) + Date.now().toString(),
            data: { studentId: normalizedId, name, email, status },
            timestamp: Date.now()
        };
        setSyncQueue(prev => [...prev, task]);
    }
    return { success: true, message: 'Recording attendance...' };
  }, [scriptUrl]);

  const handleBulkStatusUpdate = useCallback((studentIds: string[], status: 'P' | 'A') => {
    const normalizedIds = studentIds.map(id => id.toUpperCase());
    setAttendanceList(prevList => prevList.map(student => normalizedIds.includes(student.studentId) ? { ...student, status } : student));
    if (scriptUrl && scriptUrl.startsWith('http')) {
        const newTasks: SyncTask[] = normalizedIds.map(id => {
            const student = attendanceList.find(s => s.studentId === id);
            return student ? {
                id: Math.random().toString(36).substring(2, 9) + Date.now().toString(),
                data: { studentId: student.studentId, name: student.name, email: student.email, status },
                timestamp: Date.now()
            } : null;
        }).filter(t => t !== null) as SyncTask[];
        setSyncQueue(prev => [...prev, ...newTasks]);
    }
  }, [attendanceList, scriptUrl]);

  const handleRemoveStudents = useCallback((studentIds: string[]) => {
      const normalizedIds = studentIds.map(id => id.toUpperCase());
      setLocallyDeletedIds(prev => {
          const next = new Set(prev);
          normalizedIds.forEach(id => next.add(id));
          return next;
      });
      setAttendanceList(prevList => prevList.filter(s => !normalizedIds.includes(s.studentId.toUpperCase())));
  }, []);

  const handleClearAttendance = useCallback(() => {
    if (attendanceList.length === 0) return;
    if (window.confirm("Are you sure you want to clear the current attendance list? This will hide existing records until they are scanned again.")) {
      const currentIds = attendanceList.map(s => s.studentId.toUpperCase());
      setLocallyDeletedIds(prev => {
        const next = new Set(prev);
        currentIds.forEach(id => next.add(id));
        return next;
      });
      setAttendanceList([]);
    }
  }, [attendanceList]);

  return (
    <div className="min-h-screen bg-base-100 flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-7xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-brand-primary to-brand-secondary">
            UTS QR Attendance
          </h1>
          <p className="text-gray-500 mt-2">Simple, secure attendance tracking.</p>
        </header>
        <main className="bg-base-200 rounded-xl shadow-lg p-4 sm:p-8">
          {view === 'student' ? (
            <StudentView 
                markAttendance={handleMarkAttendance} 
                token={token || 'admin-bypass'} 
                bypassRestrictions={isKioskMode}
                onExit={isKioskMode ? () => { setIsKioskMode(false); setView('teacher'); } : undefined}
                isSyncing={syncQueue.length > 0}
            />
          ) : (
            <TeacherView 
                attendanceList={attendanceList} 
                onTestAttendance={() => handleMarkAttendance("TEST STUDENT", `TEST-${Math.floor(Math.random()*1000)}`, "test@uts.edu.my")} 
                onClearAttendance={handleClearAttendance}
                onRemoveStudents={handleRemoveStudents}
                onBulkStatusUpdate={handleBulkStatusUpdate}
                scriptUrl={scriptUrl} 
                onScriptUrlChange={setScriptUrl} 
                onOpenKiosk={() => { setIsKioskMode(true); setView('student'); }}
                onManualAdd={handleMarkAttendance}
                pendingSyncCount={syncQueue.length}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
