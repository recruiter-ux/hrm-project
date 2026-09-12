'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import { buttonClass, EmptyState, ErrorBanner, inputClass, Spinner } from '@/components/ui';
import { api, ApiError, downloadUrl } from '@/lib/api';
import type { DocumentItem } from '@/lib/types';

const DOCUMENT_TYPES = [
  'CONTRACT',
  'OFFER_LETTER',
  'NATIONAL_ID',
  'PASSPORT',
  'VISA',
  'WORK_PERMIT',
  'EDUCATION_CERTIFICATE',
  'PROFESSIONAL_CERTIFICATION',
  'RESUME',
  'TAX_FORM',
  'BANK_DETAILS',
  'MEDICAL',
  'PERFORMANCE_REVIEW',
  'DISCIPLINARY',
  'OTHER',
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsSection({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();

  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<string>('CONTRACT');
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isConfidential, setIsConfidential] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDocuments(await api<DocumentItem[]>(`/api/employees/${employeeId}/documents`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load documents.');
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError('Choose a file first.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      // Metadata rides in the query string because the body is multipart
      // form-data carrying the file itself.
      const params = new URLSearchParams({ type, isConfidential: String(isConfidential) });
      if (title.trim()) params.set('title', title.trim());
      if (expiresAt) params.set('expiresAt', new Date(expiresAt).toISOString());

      const form = new FormData();
      form.append('file', file);

      await api(`/api/employees/${employeeId}/documents?${params}`, {
        method: 'POST',
        body: form,
      });

      if (fileInput.current) fileInput.current.value = '';
      setTitle('');
      setExpiresAt('');
      setIsConfidential(false);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Remove "${name}"? The file stays in storage but is hidden.`)) return;
    try {
      await api(`/api/documents/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the document.');
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Documents</h2>
        {can('document:upload') && (
          <button onClick={() => setShowForm((v) => !v)} className={buttonClass}>
            {showForm ? 'Cancel' : 'Upload document'}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {showForm && can('document:upload') && (
        <form
          onSubmit={handleUpload}
          className="space-y-3 rounded-lg border border-[var(--border)] p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">File</span>
              <input
                ref={fileInput}
                type="file"
                required
                className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
              />
              <span className="mt-1 block text-xs text-[var(--muted)]">
                PDF, image, Word, Excel, CSV, or text. Up to 10 MB.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Defaults to the filename"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Expires</span>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-[var(--muted)]">
                For visas, permits, and certifications.
              </span>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isConfidential}
              onChange={(e) => setIsConfidential(e.target.checked)}
            />
            Confidential — hide from anyone without HR-level document access
          </label>

          <button type="submit" disabled={uploading} className={buttonClass}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      )}

      {documents === null && <Spinner label="Loading documents…" />}

      {documents?.length === 0 && (
        <EmptyState title="No documents yet" hint="Contracts, IDs, and certificates go here." />
      )}

      {documents && documents.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {documents.map((doc) => {
            const expired = doc.expiresAt && new Date(doc.expiresAt) < new Date();
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{doc.title}</span>
                    {doc.isConfidential && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
                        confidential
                      </span>
                    )}
                    {expired && (
                      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-800 dark:bg-orange-950 dark:text-orange-300">
                        expired
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {doc.type.replace(/_/g, ' ').toLowerCase()} · {formatBytes(doc.sizeBytes)} ·
                    uploaded {new Date(doc.createdAt).toLocaleDateString()}
                    {doc.uploadedBy && ` by ${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`}
                    {doc.expiresAt && ` · expires ${new Date(doc.expiresAt).toLocaleDateString()}`}
                  </div>
                </div>

                <a
                  href={downloadUrl(doc.id)}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm transition-opacity hover:opacity-70"
                >
                  Download
                </a>

                {can('document:upload') && (
                  <button
                    onClick={() => void handleDelete(doc.id, doc.title)}
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-red-700 transition-opacity hover:opacity-70 dark:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
