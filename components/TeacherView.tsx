
import React, { useState, useEffect, useRef } from 'react';
import type { Student } from '../types';
import QRCode from 'qrcode';
import { DownloadIcon } from './icons/DownloadIcon';
import { EyeIcon } from './icons/EyeIcon';
import { EyeSlashIcon } from './icons/EyeSlashIcon';
import { UserIcon } from './icons/UserIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { ClockIcon } from './icons/ClockIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { GoogleSheetIntegrationInfo } from './GoogleSheetIntegrationInfo';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

interface TeacherViewProps {
  attendanceList: Student[];
  onTestAttendance: () => void;
  onClearAttendance: () => void;
  onRemoveStudents: (studentIds: string[]) => void;
  onBulkStatusUpdate: (studentIds: string[], status: 'P' | 'A') => void;
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onOpenKiosk: () => void;
  onManualAdd: (name: string, id: string, email: string, status: 'P' | 'A') => {success: boolean, message: string};
}

type SortOption = 'id' | 'newest' | 'oldest';

export const TeacherView: React.FC<TeacherViewProps> = ({ 
  attendanceList, 
  onTestAttendance, 
  onClearAttendance, 
  onRemoveStudents,
  onBulkStatusUpdate,
  scriptUrl, 
  onScriptUrlChange, 
  onOpenKiosk, 
  onManualAdd 
}) => {
  const [baseUrl, setBaseUrl] = useState<string>(window.location.href.split('?')[0]);
  const [qrData, setQrData] = useState<string>('');
  
  const [showEmailSetup, setShowEmailSetup] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'teacher' | 'classroom'>('teacher');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  
  // Filter State
  const [timeFilter, setTimeFilter] = useState<'all' | number>('all');
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Manual Entry State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualStatus, setManualStatus] = useState<'P' | 'A'>('P');
  const [manualError, setManualError] = useState('');
  const [manualIsNew, setManualIsNew] = useState(false);
  
  // Logo State
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const isLocalFile = window.location.protocol === 'file:';

  // Load UTS Logo once
  useEffect(() => {
    const img = new Image();
    img.src = "https://upload.wikimedia.org/wikipedia/en/2/23/University_of_Technology_Sarawak_Logo.png";
    img.crossOrigin = "Anonymous";
    img.onload = () => setLogoImg(img);
  }, []);

  useEffect(() => {
    const updateQR = () => {
        let cleanBaseUrl = baseUrl.trim();
        const timestamp = Date.now().toString();
        const separator = cleanBaseUrl.includes('?') ? '&' : '?';
        const fullUrl = `${cleanBaseUrl}${separator}t=${timestamp}`;
        setQrData(fullUrl);
    };

    updateQR();
    const interval = setInterval(updateQR, 1000);
    return () => clearInterval(interval);
  }, [baseUrl]);

  useEffect(() => {
    if (canvasRef.current && qrData) {
      QRCode.toCanvas(canvasRef.current, qrData, { 
          width: 600, // Increased resolution for larger display
          color: { dark: '#000000', light: '#ffffff' },
          margin: 2,
          errorCorrectionLevel: 'H' // High error correction to allow logo embedding
        }, (error) => {
        if (error) {
            console.error(error);
            return;
        }

        // Draw Logo Center if loaded
        if (logoImg && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                const size = 600;
                const logoDim = 120; // Size of the logo (20% of QR)
                const xy = (size - logoDim) / 2;
                
                // Draw white background circle for logo visibility
                ctx.beginPath();
                ctx.arc(size/2, size/2, (logoDim/2) + 5, 0, 2 * Math.PI);
                ctx.fillStyle = '#ffffff';
                ctx.fill();

                // Draw UTS Logo
                ctx.drawImage(logoImg, xy, xy, logoDim, logoDim);
            }
        }
      });
    }
  }, [qrData, logoImg]);

  // Update current time periodically for filtering
  useEffect(() => {
    if (timeFilter === 'all') return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [timeFilter]);

  const sortList = (list: Student[]) => {
    const sorted = [...list];
    switch (sortBy) {
      case 'id':
        return sorted.sort((a, b) => a.studentId.localeCompare(b.studentId, undefined, { numeric: true }));
      case 'newest':
        return sorted.sort((a, b) => b.timestamp - a.timestamp);
      case 'oldest':
        return sorted.sort((a, b) => a.timestamp - b.timestamp);
      default:
        return sorted;
    }
  };

  const getVisibleList = () => {
    let list = attendanceList;
    if (timeFilter !== 'all') {
        const cutoff = currentTime - (timeFilter * 60 * 1000);
        list = list.filter(s => s.timestamp >= cutoff);
    }
    return sortList(list);
  };
  
  const visibleList = getVisibleList();

  const handleExportCSV = () => {
    if (attendanceList.length === 0) return;
    const headers = ['Timestamp', 'Student Name', 'Student ID', 'Email', 'Status'];
    
    // Always export full history, regardless of filter
    const dataToExport = sortList(attendanceList);

    const csvRows = [
      headers.join(','),
      ...dataToExport.map(student => {
        const timestamp = new Date(student.timestamp).toLocaleString();
        const name = `"${String(student.name).replace(/"/g, '""')}"`;
        const studentId = `"${String(student.studentId).replace(/"/g, '""')}"`;
        const email = `"${String(student.email).replace(/"/g, '""')}"`;
        // Ensure status is definitely P or A
        const status = (student.status === 'A') ? 'A' : 'P';
        return [timestamp, name, studentId, email, status].join(',');
      })
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const date = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `attendance-history-${date}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Bulk Selection Handlers
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
  };

  const toggleSelectAll = () => {
    // Select based on VISIBLE list
    const allSelected = visibleList.length > 0 && visibleList.every(s => selectedIds.has(s.studentId));

    if (allSelected) {
        setSelectedIds(new Set());
    } else {
        // Only select visible items
        const visibleIds = visibleList.map(s => s.studentId);
        setSelectedIds(new Set(visibleIds));
    }
  };

  const handleBulkStatusChange = (e: React.MouseEvent, status: 'P' | 'A') => {
      e.preventDefault();
      if (selectedIds.size === 0) return;
      onBulkStatusUpdate(Array.from(selectedIds), status);
      setSelectedIds(new Set()); // Clear selection after update
  };

  const handleBulkRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (selectedIds.size === 0) return;
    
    setTimeout(() => {
        if (window.confirm(`Remove ${selectedIds.size} students from the attendance history?\n\nThis will clear them from your screen but will NOT delete their record from the Google Sheet.`)) {
            onRemoveStudents(Array.from(selectedIds));
            setSelectedIds(new Set()); // Clear selection after delete
        }
    }, 50);
  };

  // Manual Entry Handlers
  const handleManualIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setManualId(val);

    const matched = PRE_REGISTERED_STUDENTS.find(s => s.id === val);
    if (matched) {
        setManualName(matched.name);
        setManualIsNew(false);
    } else {
        if (PRE_REGISTERED_STUDENTS.some(s => s.name === manualName)) {
            setManualName('');
        }
        setManualIsNew(true);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualId || !manualName) {
        setManualError('ID and Name are required.');
        return;
    }
    
    const studentIdRegex = /^[A-Z]{3}\d{8}$/;
    if (!studentIdRegex.test(manualId)) {
        setManualError('Invalid ID format (3 Letters + 8 Numbers).');
        return;
    }

    const email = `${manualId}@STUDENT.UTS.EDU.MY`;
    
    const result = onManualAdd(manualName, manualId, email, manualStatus);
    
    if (result.success) {
        setShowManualModal(false);
        setManualId('');
        setManualName('');
        setManualStatus('P');
        setManualError('');
    } else {
        setManualError(result.message);
    }
  };

  return (
    <div className="w-full relative">
       {/* View Mode Toggle Button */}
       <div className="absolute -top-12 right-0">
         <button 
           type="button"
           onClick={() => setViewMode(viewMode === 'teacher' ? 'classroom' : 'teacher')}
           className="p-2 rounded-full bg-base-100 hover:bg-base-300 text-gray-600 transition-colors"
           title={viewMode === 'teacher' ? "Switch to Classroom View" : "Switch to Teacher View"}
         >
            {viewMode === 'teacher' ? <EyeIcon className="w-6 h-6" /> : <EyeSlashIcon className="w-6 h-6" />}
         </button>
       </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        
        {/* LEFT COLUMN: Attendance List */}
        <div className="w-full lg:w-[40%] order-2 lg:order-1">
          <div className="flex flex-col gap-3 mb-4">
             <div className="flex justify-between items-center flex-wrap gap-2">
                <h2 className="text-2xl font-bold text-brand-primary">Attendance History</h2>
                <div className="flex items-center gap-2">
                    {/* Time Filter */}
                    <div className="flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 shadow-sm" title="Auto-hide older records">
                        <ClockIcon className="w-3 h-3 text-gray-500" />
                        <select 
                            value={timeFilter} 
                            onChange={(e) => setTimeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                            className="text-xs bg-transparent text-gray-700 focus:outline-none cursor-pointer border-none"
                        >
                            <option value="all">Show All</option>
                            <option value="1">Last 1 Min</option>
                            <option value="5">Last 5 Mins</option>
                            <option value="15">Last 15 Mins</option>
                            <option value="30">Last 30 Mins</option>
                        </select>
                    </div>

                    {/* Sort */}
                    <select 
                    value={sortBy} 
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-primary shadow-sm"
                    >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="id">Sort by ID</option>
                    </select>
                </div>
             </div>
            
            {viewMode === 'teacher' && (
                <div className="flex flex-col gap-2">
                     <div className="flex gap-2">
                        {/* Manual Entry Button */}
                        <button
                            type="button"
                            onClick={() => setShowManualModal(true)}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-brand-primary text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-brand-secondary focus:outline-none focus:ring-2 focus:ring-brand-light focus:ring-opacity-75 transition-colors"
                        >
                            <PencilSquareIcon className="w-4 h-4" />
                            Add Student
                        </button>

                        {/* Admin Mode Button */}
                        <button
                            type="button"
                            onClick={onOpenKiosk}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg shadow-sm hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 transition-colors"
                        >
                            <ShieldCheckIcon className="w-4 h-4" />
                            Admin Mode
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {selectedIds.size > 0 ? (
                            <>
                                <button
                                    type="button"
                                    onClick={(e) => handleBulkStatusChange(e, 'P')}
                                    className="flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75 transition-colors"
                                    title="Mark Selected Present"
                                >
                                    <CheckCircleIcon className="w-4 h-4" />
                                    Present
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => handleBulkStatusChange(e, 'A')}
                                    className="flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-opacity-75 transition-colors"
                                    title="Mark Selected Absent"
                                >
                                    <XCircleIcon className="w-4 h-4" />
                                    Absent
                                </button>
                                <button
                                    type="button"
                                    onClick={handleBulkRemove}
                                    className="flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-75 transition-colors"
                                    title="Remove Selected from View"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                    Remove
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={onClearAttendance}
                                disabled={attendanceList.length === 0}
                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-100 text-red-700 text-xs font-semibold rounded-lg shadow-sm hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-75 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                            >
                                <TrashIcon className="w-4 h-4" />
                                Clear All
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onTestAttendance}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg shadow-sm hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-75 transition-colors"
                        >
                            <UserIcon className="w-4 h-4" />
                            Test
                        </button>
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            disabled={attendanceList.length === 0}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-brand-secondary text-white text-xs font-semibold rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                            <DownloadIcon className="w-4 h-4" />
                            CSV
                        </button>
                    </div>
                </div>
            )}
          </div>
          
          <div className="bg-base-100 rounded-lg p-2 max-h-[600px] overflow-y-auto shadow-sm border border-base-300">
            {attendanceList.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No students have checked in yet.</p>
            ) : visibleList.length === 0 ? (
              <div className="text-center py-8">
                  <p className="text-gray-500">No scans in the last {timeFilter} minute{timeFilter !== 1 ? 's' : ''}.</p>
                  <button onClick={() => setTimeFilter('all')} className="text-brand-primary text-xs font-bold mt-2 hover:underline">
                      Show Full History
                  </button>
              </div>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-700">
                  <thead className="text-xs text-gray-500 uppercase bg-base-200 sticky top-0">
                    <tr>
                      {viewMode === 'teacher' && (
                          <th scope="col" className="px-4 py-3 w-4">
                            <input 
                                type="checkbox"
                                className="w-4 h-4 text-brand-primary bg-gray-100 border-gray-300 rounded focus:ring-brand-primary"
                                checked={visibleList.length > 0 && visibleList.every(s => selectedIds.has(s.studentId))}
                                onChange={toggleSelectAll}
                            />
                          </th>
                      )}
                      <th scope="col" className="px-4 py-3 text-left">Student ID</th>
                      <th scope="col" className="px-4 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleList.map((student, index) => {
                      const isAbsent = student.status === 'A';
                      const isSelected = selectedIds.has(student.studentId);
                      return (
                        <tr 
                            key={`${student.studentId}-${student.timestamp}-${index}`} 
                            className={`border-b border-base-200 hover:bg-base-300 ${isSelected ? 'bg-indigo-50' : (isAbsent ? 'bg-red-50' : 'bg-base-100')}`}
                        >
                          {viewMode === 'teacher' && (
                              <td className="px-4 py-3 w-4">
                                <input 
                                    type="checkbox"
                                    className="w-4 h-4 text-brand-primary bg-gray-100 border-gray-300 rounded focus:ring-brand-primary"
                                    checked={isSelected}
                                    onChange={() => toggleSelection(student.studentId)}
                                />
                              </td>
                          )}
                          <td className={`px-4 py-3 font-mono font-bold text-left ${isAbsent ? 'text-red-600' : 'text-gray-900'}`}>
                              {student.studentId}
                              {isAbsent && <span className="ml-2 text-xs font-normal bg-red-100 text-red-600 px-1 rounded">ABSENT</span>}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap text-right ${isAbsent ? 'text-red-400' : 'text-gray-500'}`}>
                              {new Date(student.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: QR Code & Config */}
        <div className="w-full lg:flex-1 flex flex-col items-center bg-base-100 p-6 rounded-lg shadow-md order-1 lg:order-2">
          
          {/* Warning for Local File usage */}
          {isLocalFile && viewMode === 'teacher' && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4 w-full rounded-md">
              <div className="flex flex-col gap-2">
                <div className="flex items-start">
                    <div className="ml-3">
                      <p className="text-sm text-yellow-700">
                        <strong className="font-bold">This is a local file.</strong> Phones cannot scan this QR code yet.
                      </p>
                    </div>
                </div>
              </div>
            </div>
          )}

          {/* Configuration Inputs - HIDDEN in Classroom Mode */}
          {viewMode === 'teacher' && (
              <div className="w-full space-y-4 mb-4">
                  <div>
                      <label htmlFor="baseUrl" className="block text-sm font-medium text-gray-700 mb-1">System URL (For QR Code)</label>
                      <input
                          type="text"
                          id="baseUrl"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder="https://your-site.com"
                          className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-primary focus:border-brand-primary sm:text-sm text-gray-500"
                      />
                  </div>
                  
                  {/* Email Integration Toggle */}
                  <div className="pt-2">
                    <button 
                      type="button"
                      onClick={() => setShowEmailSetup(!showEmailSetup)}
                      className="text-sm text-brand-primary underline hover:text-brand-secondary font-medium"
                    >
                      {showEmailSetup ? 'Hide Cloud Storage Setup' : 'Configure Cloud Recording'}
                    </button>
                  </div>
                  
                  {showEmailSetup && (
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                      <GoogleSheetIntegrationInfo />
                      <div>
                          <label htmlFor="scriptUrl" className="block text-sm font-medium text-gray-700 mb-1">Google Web App URL</label>
                          <input
                              type="text"
                              id="scriptUrl"
                              value={scriptUrl}
                              onChange={(e) => onScriptUrlChange(e.target.value)}
                              placeholder="https://script.google.com/macros/s/..."
                              className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-primary focus:border-brand-primary sm:text-sm text-gray-500"
                          />
                      </div>
                    </div>
                  )}
              </div>
          )}

          <h2 className="text-2xl font-bold mb-4 text-brand-primary">Scan to Check-in</h2>
          <div className="bg-white p-4 rounded-lg shadow-inner border border-gray-200">
            <canvas ref={canvasRef} className="rounded-md w-full max-w-[600px] h-auto" />
          </div>
          <p className="text-gray-500 text-sm mt-4 text-center">Scan with any camera app. Refreshes every second.</p>
        </div>
      </div>

      {/* Manual Entry / Add Student Modal */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h3 className="text-lg font-bold text-gray-900">Add Student</h3>
                    <button type="button" onClick={() => setShowManualModal(false)} className="text-gray-400 hover:text-gray-500 font-bold text-xl">&times;</button>
                </div>
                <form onSubmit={handleManualSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Student ID</label>
                        <input
                            type="text"
                            value={manualId}
                            onChange={handleManualIdChange}
                            placeholder="e.g. FIA24001006"
                            className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-brand-primary focus:border-brand-primary sm:text-sm uppercase"
                        />
                        <p className="text-xs text-gray-500 mt-1">3 Letters + 8 Numbers</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                        <input
                            type="text"
                            value={manualName}
                            onChange={(e) => setManualName(e.target.value.toUpperCase())}
                            readOnly={!manualIsNew}
                            className={`block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-brand-primary focus:border-brand-primary sm:text-sm uppercase ${!manualIsNew && manualName ? 'bg-gray-100' : ''}`}
                        />
                    </div>
                    
                    <div>
                      <span className="block text-sm font-medium text-gray-700 mb-2">Status</span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center">
                          <input 
                            type="radio" 
                            name="status" 
                            value="P" 
                            checked={manualStatus === 'P'} 
                            onChange={() => setManualStatus('P')}
                            className="h-4 w-4 text-brand-primary focus:ring-brand-primary border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-700">Present</span>
                        </label>
                        <label className="flex items-center">
                          <input 
                            type="radio" 
                            name="status" 
                            value="A" 
                            checked={manualStatus === 'A'} 
                            onChange={() => setManualStatus('A')}
                            className="h-4 w-4 text-red-600 focus:ring-red-600 border-gray-300"
                          />
                          <span className="ml-2 text-sm text-gray-700">Absent</span>
                        </label>
                      </div>
                    </div>

                    {manualError && <p className="text-sm text-red-600 font-medium">{manualError}</p>}
                    
                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={() => setShowManualModal(false)}
                            className="flex-1 py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-primary hover:bg-brand-secondary focus:outline-none"
                        >
                            Confirm
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};
