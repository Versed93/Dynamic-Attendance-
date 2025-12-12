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
  // Determine view based on URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('t');
  
  const initialView: View = token ? 'student' : 'teacher';

  const [view, setView] = useState<View>(initialView);
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [attendanceList, setAttendanceList] = useState<Student[]>([]);
  
  // Track IDs that have been explicitly deleted locally so polling doesn't bring them back
  const [locallyDeletedIds, setLocallyDeletedIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(DELETED_IDS_KEY);
    try {
        return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
        return new Set();
    }
  });
  
  // Initialize with the user-provided Web App URL or empty.
  const [scriptUrl, setScriptUrl] = useState<string>(() => {
    const saved = localStorage.getItem(SCRIPT_URL_KEY);
    return saved || 'https://script.google.com/macros/s/AKfycbxPcnCL5b7z_C9-PJXQH03r9IMPoDlxOeJqSv5A6ZtQCmgCk6XDeBUDcDjYaDX9gbIx/exec';
  });

  // Sync Queue State - Initialize from LocalStorage to persist across reloads
  const [syncQueue, setSyncQueue] = useState<SyncTask[]>(() => {
      try {
          const saved = localStorage.getItem(SYNC_QUEUE_KEY);
          return saved ? JSON.parse(saved) : [];
      } catch (e) {
          return [];
      }
  });
  const [isSyncing, setIsSyncing] = useState(false);

  // --- PERSISTENCE EFFECTS ---

  // Load attendance data from LocalStorage on mount
  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (Array.isArray(parsed)) {
          setAttendanceList(parsed);
        }
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

  // Save Sync Queue
  useEffect(() => {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  }, [syncQueue]);

  // --- SYNC PROCESSOR ---
  // Processes queue items one by one to prevent hitting Google Script rate limits/lock contention
  useEffect(() => {
    if (syncQueue.length === 0 || isSyncing) return;
    if (!scriptUrl || !scriptUrl.startsWith('http')) return;

    const processNext = async () => {
        setIsSyncing(true);
        const task = syncQueue[0];

        try {
            const formData = new URLSearchParams();
            Object.entries(task.data).forEach(([k, v]) => formData.append(k, String(v)));

            // We use no-cors + keepalive to ensure it sends even if tab closes, 
            // and we don't care about reading the opaque response.
            await fetch(scriptUrl.trim(), {
                method: 'POST',
                mode: 'no-cors',
                keepalive: true, 
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            // THROTTLE: Wait 800ms before next request to allow Google Script Lock to release
            await new Promise(resolve => setTimeout(resolve, 800));

            // Remove from queue on "success" (no network error)
            setSyncQueue(prev => prev.filter(t => t.id !== task.id));

        } catch (err) {
            console.error("Sync failed, retrying in 5s...", err);
            // On network error, keep item in queue and wait 5s before retrying
            await new Promise(resolve => setTimeout(resolve, 5000));
        } finally {
            setIsSyncing(false);
        }
    };

    processNext();
  }, [syncQueue, isSyncing, scriptUrl]);


  // --- POLLING ---
  // Poll for updates if scriptUrl is present and we are in Teacher View
  useEffect(() => {
    if (!scriptUrl || !scriptUrl.startsWith('http') || view === 'student') return;

    let isMounted = true;

    const fetchData = async () => {
      try {
        const response = await fetch(`${scriptUrl.trim()}?action=read&_=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { 'Content-Type': 'text/plain' },
        });
        
        if (!response.ok) return;

        const data = await response.json();
        
        if (isMounted && Array.isArray(data)) {
           setAttendanceList(prevList => {
               const mergedMap = new Map<string, Student>();
               
               // 1. Start with existing local data
               prevList.forEach(s => {
                   if (s.studentId) {
                       mergedMap.set(s.studentId.toUpperCase(), s);
                   }
               });
               
               // 2. Merge server data
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
      } catch (e) {
        console.warn('Polling failed:', e);
      }
    };

    const interval = setInterval(fetchData, 5000);
    fetchData(); 
    return () => {
        isMounted = false;
        clearInterval(interval);
    };
  }, [scriptUrl, view, locallyDeletedIds]);

  const handleMarkAttendance = useCallback((name: string, studentId: string, email: string, status: 'P' | 'A' = 'P'): { success: boolean, message: string } => {
    const normalizedId = studentId.toUpperCase();
    
    // Check local duplicates
    const isDuplicate = attendanceList.some(s => s.studentId.toUpperCase() === normalizedId);
    
    // If student was previously deleted locally, un-delete them
    setLocallyDeletedIds(prev => {
        if (prev.has(normalizedId)) {
            const next = new Set(prev);
            next.delete(normalizedId);
            return next;
        }
        return prev;
    });

    const newStudent: Student = {
      name,
      studentId: normalizedId,
      email,
      timestamp: Date.now(),
      status
    };

    // Optimistic Update
    if (!isDuplicate) {
        setAttendanceList(prevList => [newStudent, ...prevList]);
    } else {
         setAttendanceList(prevList => {
             const filtered = prevList.filter(s => s.studentId.toUpperCase() !== normalizedId);
             return [newStudent, ...filtered];
         });
    }
    
    // Add to Background Sync Queue
    if (scriptUrl && scriptUrl.startsWith('http')) {
        const task: SyncTask = {
            id: Math.random().toString(36).substring(2, 9) + Date.now().toString(),
            data: {
                studentId: normalizedId,
                name: name,
                email: email,
                status: status
            },
            timestamp: Date.now()
        };
        setSyncQueue(prev => [...prev, task]);
    }

    return { success: true, message: 'Attendance recorded!' };
  }, [attendanceList, scriptUrl]);

  const handleBulkStatusUpdate = useCallback((studentIds: string[], status: 'P' | 'A') => {
    const normalizedIds = studentIds.map(id => id.toUpperCase());

    // 1. Update Local State Immediately
    setAttendanceList(prevList => prevList.map(student => {
        if (normalizedIds.includes(student.studentId)) {
            return { ...student, status };
        }
        return student;
    }));

    // 2. Queue updates for Background Sync
    if (scriptUrl && scriptUrl.startsWith('http')) {
        const newTasks: SyncTask[] = [];
        
        normalizedIds.forEach(id => {
            const student = attendanceList.find(s => s.studentId === id);
            // If student isn't found in current list but we are updating them, 
            // we skip valid data check. Ideally we should have the data.
            // We use the data from the list.
            if (student) {
                newTasks.push({
                    id: Math.random().toString(36).substring(2, 9) + Date.now().toString(),
                    data: {
                        studentId: student.studentId,
                        name: student.name,
                        email: student.email,
                        status: status
                    },
                    timestamp: Date.now()
                });
            }
        });
        
        setSyncQueue(prev => [...prev, ...newTasks]);
    }
  }, [attendanceList, scriptUrl]);

  const handleTestAttendance = () => {
      const randomId = Math.floor(Math.random() * 1000);
      const newStudent = {
          name: "TEST STUDENT",
          studentId: `TEST-${randomId}`,
          email: `TEST${randomId}@EXAMPLE.COM`,
          status: 'P' as 'P' | 'A'
      };
      handleMarkAttendance(newStudent.name, newStudent.studentId, newStudent.email, 'P');
  };

  const handleClearAttendance = () => {
      if (window.confirm("WARNING: This will clear the LOCAL attendance list. It will NOT delete data from the Google Sheet.")) {
        const currentIds = attendanceList.map(s => s.studentId.toUpperCase());
        setLocallyDeletedIds(prev => {
            const next = new Set(prev);
            currentIds.forEach(id => next.add(id));
            return next;
        });
        setAttendanceList([]);
      }
  };

  const handleRemoveStudents = useCallback((studentIds: string[]) => {
      const normalizedIds = studentIds.map(id => id.toUpperCase());
      setLocallyDeletedIds(prev => {
          const next = new Set(prev);
          normalizedIds.forEach(id => next.add(id));
          return next;
      });
      setAttendanceList(prevList => prevList.filter(s => !normalizedIds.includes(s.studentId.toUpperCase())));
  }, []);
  
  const handleOpenKiosk = () => {
    setIsKioskMode(true);
    setView('student');
  };

  const handleExitKiosk = () => {
    setIsKioskMode(false);
    setView('teacher');
  };

  const renderView = () => {
    if (view === 'student') {
        return (
            <StudentView 
                markAttendance={handleMarkAttendance} 
                token={token || 'admin-bypass'} 
                bypassRestrictions={isKioskMode}
                onExit={isKioskMode ? handleExitKiosk : undefined}
            />
        );
    }
    return (
        <TeacherView 
            attendanceList={attendanceList} 
            onTestAttendance={handleTestAttendance} 
            onClearAttendance={handleClearAttendance}
            onRemoveStudents={handleRemoveStudents}
            onBulkStatusUpdate={handleBulkStatusUpdate}
            scriptUrl={scriptUrl} 
            onScriptUrlChange={setScriptUrl} 
            onOpenKiosk={handleOpenKiosk}
            onManualAdd={handleMarkAttendance}
            pendingSyncCount={syncQueue.length}
        />
    );
  };

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
          {renderView()}
        </main>
      </div>
    </div>
  );
};

export default App;