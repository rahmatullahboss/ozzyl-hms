import React, { useState } from 'react';
import { Search, Upload, FileText, FlaskConical, Pill, Download, Share2, Loader2, FileImage } from 'lucide-react';
import { useDocuments } from '../../hooks/usePatientWellness';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

const CATEGORIES = [
  { id: 'all', label: 'All Files' },
  { id: 'record', label: 'Records' },
  { id: 'lab', label: 'Labs' },
  { id: 'prescription', label: 'Prescriptions' },
];

export const MedicalDocumentVault: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data, isLoading } = useDocuments(1, 50);

  const docs = data?.data || [];

  const filteredDocs = docs.filter(doc => 
    (activeCategory === 'all' || doc.type === activeCategory) &&
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getIconForType = (type: string) => {
    switch (type) {
      case 'record': return <FileText className="w-5 h-5 text-indigo-500" />;
      case 'lab': return <FlaskConical className="w-5 h-5 text-rose-500" />;
      case 'prescription': return <Pill className="w-5 h-5 text-teal-500" />;
      case 'image': return <FileImage className="w-5 h-5 text-amber-500" />;
      default: return <FileText className="w-5 h-5 text-slate-500" />;
    }
  };
  
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full bg-slate-50 flex flex-col font-sans rounded-3xl overflow-hidden min-h-[80vh]">
      <header className="p-8 bg-white border-b border-slate-100 flex flex-col gap-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Document Vault</h1>
            <p className="text-sm text-slate-500 mt-1">Secure and organized medical records</p>
          </div>
          <button data-testid="upload-btn" className="px-5 py-2.5 bg-emerald-50 text-emerald-700 rounded-full hover:bg-emerald-100 transition-colors flex items-center gap-2 font-medium">
            <Upload className="w-5 h-5" />
            Upload File
          </button>
        </div>
        
        {/* Search Bar */}
        <div className="relative max-w-xl">
          <Search className="w-5 h-5 absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by document title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-14 pr-5 py-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all outline-none font-medium placeholder:font-normal placeholder:text-slate-400"
          />
        </div>
      </header>

      <main className="flex-1 p-8">
        {/* Categories (Horizontal Scroll) */}
        <div className="flex space-x-3 overflow-x-auto pb-6 scrollbar-hide">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              data-testid={`category-${cat.id}`}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-6 py-3 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                activeCategory === cat.id
                  ? 'bg-slate-800 text-white shadow-md shadow-slate-200'
                  : 'bg-white text-slate-600 shadow-sm border border-slate-100 hover:bg-slate-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Document List */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {isLoading ? (
             <div className="col-span-full py-12 flex items-center justify-center">
               <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
             </div>
          ) : filteredDocs.length > 0 ? (
            filteredDocs.map((doc) => (
              <div key={doc.id} data-testid={`doc-${doc.id}`} className="group p-5 bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl group-hover:bg-indigo-50/50 transition-colors">
                    {getIconForType(doc.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-slate-800 line-clamp-1">{doc.title || 'Untitled Document'}</h3>
                    <p className="text-sm text-slate-500 mt-1 line-clamp-1">{doc.description || 'No description provided'}</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-2">
                   <div className="text-sm font-medium text-slate-400">
                     {formatPatientDateMonthYear(doc.date)} • {formatBytes(doc.fileSize)}
                   </div>
                   <div className="flex gap-2">
                    <button className="p-2.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors">
                      <Download className="w-4 h-4" />
                    </button>
                    <button className="p-2.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors">
                      <Share2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-slate-100 border-dashed">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-800 font-medium text-lg">No documents found</p>
              <p className="text-slate-500 text-sm mt-1">Upload a file or change categories to view records.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

