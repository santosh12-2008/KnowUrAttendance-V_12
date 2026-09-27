import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, Plus, Copy, Check, Trash2, Users, Download, 
  ExternalLink, Eye, ChevronRight, AlertCircle, FileText
} from 'lucide-react';

export default function DepartmentFormsManager() {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFormId, setSelectedFormId] = useState(null);
  const [responsesData, setResponsesData] = useState(null);
  const [loadingResponses, setLoadingResponses] = useState(false);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // New Form Builder State
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [fields, setFields] = useState([
    { key: 'apaar_id', label: 'APAAR / ABC ID', type: 'text', required: true },
    { key: 'father_name', label: "Father's Name", type: 'text', required: true },
    { key: 'blood_group', label: 'Blood Group', type: 'text', required: false }
  ]);
  const [creating, setCreating] = useState(false);

  const fetchForms = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/forms');
      const data = await res.json();
      setForms(data);
      if (data.length > 0 && !selectedFormId) {
        handleViewResponses(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching forms:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForms();
  }, []);

  const handleViewResponses = async (formId) => {
    setSelectedFormId(formId);
    setLoadingResponses(true);
    setCopied(false);
    try {
      const res = await fetch(`/api/forms/${formId}/responses`);
      const data = await res.json();
      setResponsesData(data);
    } catch (err) {
      console.error('Error fetching responses:', err);
    } finally {
      setLoadingResponses(false);
    }
  };

  // Copy TSV for 1-click Excel pasting
  const handleCopyForExcel = () => {
    if (!responsesData || !responsesData.excel_tsv) return;
    navigator.clipboard.writeText(responsesData.excel_tsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  // Download CSV file
  const handleDownloadCsv = () => {
    if (!responsesData || !responsesData.excel_tsv) return;
    // Convert TSV to CSV
    const rows = responsesData.excel_tsv.split('\n');
    const csvContent = rows.map(r => 
      r.split('\t').map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${(responsesData.form?.title || 'form').replace(/\s+/g, '_')}_Responses.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Field Management in Form Builder
  const addField = () => {
    const num = fields.length + 1;
    setFields([...fields, { key: `field_${num}`, label: `Custom Question ${num}`, type: 'text', required: true }]);
  };

  const removeField = (index) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index, prop, value) => {
    const updated = [...fields];
    updated[index][prop] = value;
    if (prop === 'label') {
      updated[index].key = value.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }
    setFields(updated);
  };

  const handleCreateForm = async (e) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      alert('Form title is required');
      return;
    }
    if (fields.length === 0) {
      alert('Add at least one field to collect');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim(),
          fields: fields
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to create form');
      setShowCreateModal(false);
      setFormTitle('');
      setFormDescription('');
      fetchForms();
      handleViewResponses(data.id);
    } catch (err) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteForm = async (formId) => {
    if (!window.confirm('Are you sure you want to delete this form and all its responses?')) return;
    try {
      const res = await fetch(`/api/forms/${formId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete form');
      setSelectedFormId(null);
      setResponsesData(null);
      fetchForms();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <span>Department Student Data Gatherer (Excel Builder)</span>
          </h3>
          <p className="text-xs text-slate-500">
            Create custom data collection forms requested by AUCE CSE department. Collects responses strictly sorted by Roll No for 1-click copy-paste into official department Excel sheets.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Form</span>
        </button>
      </div>

      {/* Main Grid: Form List & Response Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: List of Forms */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">
              Department Forms ({forms.length})
            </h4>
          </div>

          {loading ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500">Loading forms...</p>
            </div>
          ) : forms.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
              <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs text-slate-500 font-medium">No forms created yet.</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-xs text-emerald-600 font-bold hover:underline cursor-pointer"
              >
                Create your first form
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {forms.map((f) => {
                const isSelected = selectedFormId === f.id;
                return (
                  <div
                    key={f.id}
                    onClick={() => handleViewResponses(f.id)}
                    className={`p-4 rounded-2xl border transition cursor-pointer flex items-start justify-between gap-3 ${
                      isSelected
                        ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex-1 overflow-hidden">
                      <div className="font-bold text-xs text-slate-900 truncate">
                        {f.title}
                      </div>
                      {f.description && (
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {f.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-400">
                        <span className="font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          {f.response_count} Responses
                        </span>
                        <span>•</span>
                        <span>{f.fields?.length || 0} fields</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteForm(f.id);
                      }}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition"
                      title="Delete form"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Response Sheet & 1-Click Excel Copy */}
        <div className="lg:col-span-2">
          {selectedFormId && responsesData ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              
              {/* Form Title & Excel Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h4 className="text-base font-black text-slate-900">
                    {responsesData.form?.title}
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {responsesData.total_responses} student responses recorded • Sorted by Reg. Number
                  </p>
                </div>

                {/* 1-Click Excel Copy & Download buttons */}
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleCopyForExcel}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer ${
                      copied 
                        ? 'bg-emerald-600 text-white' 
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300'
                    }`}
                    title="Copy tab-delimited text ready to paste into Excel (Ctrl+V)"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4 text-emerald-700" />}
                    <span>{copied ? 'Copied for Excel!' : 'Copy for Excel (TSV)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    className="px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
                    title="Download responses as CSV"
                  >
                    <Download className="w-4 h-4 text-slate-500" />
                    <span>Download CSV</span>
                  </button>
                </div>
              </div>

              {/* Paste helper tip */}
              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  <strong>Tip for CR:</strong> Click <strong>"Copy for Excel (TSV)"</strong>, open your Department Excel or Google Sheet, click cell A1 and press <strong>Ctrl+V</strong>. Every student's Reg No, Name, and responses will line up cleanly into their respective columns!
                </span>
              </div>

              {/* Responses Table */}
              {loadingResponses ? (
                <div className="p-12 text-center">
                  <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs text-slate-500">Loading student responses...</p>
                </div>
              ) : responsesData.responses?.length === 0 ? (
                <div className="p-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-700">No student responses submitted yet</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    This form is active in all student dashboards. When students log in, they will see this form.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[460px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-700 font-bold uppercase tracking-wider text-[10px] sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5 font-mono">Reg. No</th>
                        <th className="p-2.5">Name</th>
                        {responsesData.form?.fields?.map(f => (
                          <th key={f.key} className="p-2.5 truncate max-w-[150px]">{f.label}</th>
                        ))}
                        <th className="p-2.5">Submitted At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {responsesData.responses.map((item) => (
                        <tr key={item.student_reg_no} className="hover:bg-slate-50/70 transition">
                          <td className="p-2.5 font-mono font-bold text-blue-700 whitespace-nowrap">
                            {item.student_reg_no}
                          </td>
                          <td className="p-2.5 font-semibold whitespace-nowrap">
                            {item.student_name}
                          </td>
                          {responsesData.form?.fields?.map(f => (
                            <td key={f.key} className="p-2.5 max-w-[180px] truncate text-slate-600">
                              {String(item.responses?.[f.key] || '—')}
                            </td>
                          ))}
                          <td className="p-2.5 text-[11px] text-slate-400 whitespace-nowrap font-mono">
                            {item.submitted_at || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          ) : (
            <div className="p-16 text-center bg-white rounded-2xl border border-slate-200">
              <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">Select a form to view student responses</p>
              <p className="text-xs text-slate-400 mt-1">Or click "Create New Form" above to gather details from students.</p>
            </div>
          )}
        </div>

      </div>

      {/* Create Form Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">Create Department Data Form</h4>
                <p className="text-xs text-slate-500">
                  This form will appear in all student portals to gather required details for Excel submission.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateForm} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Form Title / Purpose *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. APAAR ID & Placement Details Form"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Instructions / Description
                </label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="e.g. Required by AU CSE HOD office for UGC-NAAC accreditation data."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Dynamic Field Builder */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 uppercase tracking-wider">
                    Form Questions / Fields ({fields.length})
                  </label>
                  <button
                    type="button"
                    onClick={addField}
                    className="text-emerald-700 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Field
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto p-1">
                  {fields.map((field, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="font-mono text-[10px] text-slate-400 font-bold w-4 text-center">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        required
                        value={field.label}
                        onChange={(e) => updateField(idx, 'label', e.target.value)}
                        placeholder="Field Label (e.g. Blood Group, ABC ID)"
                        className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium"
                      />
                      <select
                        value={field.type}
                        onChange={(e) => updateField(idx, 'type', e.target.value)}
                        className="p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700"
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeField(idx)}
                        disabled={fields.length <= 1}
                        className="p-2 text-slate-400 hover:text-rose-600 disabled:opacity-30 rounded cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {creating ? 'Creating...' : 'Publish Form to Students'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
