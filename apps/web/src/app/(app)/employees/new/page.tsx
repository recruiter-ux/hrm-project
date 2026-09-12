'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  buttonClass,
  ErrorBanner,
  Field,
  inputClass,
  secondaryButtonClass,
  Spinner,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { FormOptions } from '@/lib/types';

export default function NewEmployeePage() {
  const router = useRouter();

  const [options, setOptions] = useState<FormOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    employeeNumber: '',
    firstName: '',
    lastName: '',
    preferredName: '',
    workEmail: '',
    personalEmail: '',
    phoneNumber: '',
    timezone: 'Asia/Karachi',
    hiredAt: new Date().toISOString().slice(0, 10),
    roleId: '',
    departmentId: '',
    managerId: '',
    employmentType: 'FULL_TIME',
    workLocationType: 'ONSITE',
    workingTitle: '',
  });

  useEffect(() => {
    void (async () => {
      try {
        setOptions(await api<FormOptions>('/api/employees/options'));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load form options.');
      }
    })();
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);

    try {
      // Empty strings mean "not provided" — send undefined so the API's
      // optional-field validation does not reject them as invalid values.
      const created = await api<{ id: string }>('/api/employees', {
        method: 'POST',
        body: {
          employeeNumber: form.employeeNumber.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          preferredName: form.preferredName.trim() || undefined,
          workEmail: form.workEmail.trim(),
          personalEmail: form.personalEmail.trim() || undefined,
          phoneNumber: form.phoneNumber.trim() || undefined,
          timezone: form.timezone.trim() || undefined,
          hiredAt: new Date(form.hiredAt).toISOString(),
          roleId: form.roleId,
          departmentId: form.departmentId,
          managerId: form.managerId || undefined,
          employmentType: form.employmentType,
          workLocationType: form.workLocationType,
          workingTitle: form.workingTitle.trim() || undefined,
        },
      });
      router.push(`/employees/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? []);
      } else {
        setError('Could not create the employee.');
      }
      setSubmitting(false);
    }
  }

  if (!options && !error) return <Spinner />;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/employees"
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          ← Employees
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Add employee</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Creating an employee also opens their first employment record, dated from their hire date.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {details.length > 1 && (
        <ul className="list-inside list-disc rounded-md border border-[var(--border)] p-3 text-sm text-[var(--muted)]">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}

      {options && (
        <form onSubmit={handleSubmit} className="space-y-8">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Personal</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee number" required hint="e.g. HM-0042">
                <input
                  value={form.employeeNumber}
                  onChange={(e) => set('employeeNumber', e.target.value)}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Work email" required>
                <input
                  type="email"
                  value={form.workEmail}
                  onChange={(e) => set('workEmail', e.target.value)}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="First name" required>
                <input
                  value={form.firstName}
                  onChange={(e) => set('firstName', e.target.value)}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Last name" required>
                <input
                  value={form.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Preferred name" hint="If different from their legal first name">
                <input
                  value={form.preferredName}
                  onChange={(e) => set('preferredName', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Personal email" hint="Used for offboarding">
                <input
                  type="email"
                  value={form.personalEmail}
                  onChange={(e) => set('personalEmail', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Phone">
                <input
                  value={form.phoneNumber}
                  onChange={(e) => set('phoneNumber', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Timezone" hint="Attendance depends on this">
                <input
                  value={form.timezone}
                  onChange={(e) => set('timezone', e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Job</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hire date" required>
                <input
                  type="date"
                  value={form.hiredAt}
                  onChange={(e) => set('hiredAt', e.target.value)}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Job title (Role)" required>
                <select
                  value={form.roleId}
                  onChange={(e) => set('roleId', e.target.value)}
                  required
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {options.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                      {role.jobFamily ? ` (${role.jobFamily})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department" required>
                <select
                  value={form.departmentId}
                  onChange={(e) => set('departmentId', e.target.value)}
                  required
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {options.departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} ({dept.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Manager" hint="Leave blank if they report to nobody">
                <select
                  value={form.managerId}
                  onChange={(e) => set('managerId', e.target.value)}
                  className={inputClass}
                >
                  <option value="">No manager</option>
                  {options.managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} ({m.employeeNumber})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Employment type">
                <select
                  value={form.employmentType}
                  onChange={(e) => set('employmentType', e.target.value)}
                  className={inputClass}
                >
                  {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'].map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ').toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Work location">
                <select
                  value={form.workLocationType}
                  onChange={(e) => set('workLocationType', e.target.value)}
                  className={inputClass}
                >
                  {['ONSITE', 'REMOTE', 'HYBRID'].map((t) => (
                    <option key={t} value={t}>
                      {t.toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Working title"
                hint='Optional override, e.g. "Software Engineer II, Platform"'
              >
                <input
                  value={form.workingTitle}
                  onChange={(e) => set('workingTitle', e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          <div className="flex gap-3">
            <button type="submit" disabled={submitting} className={buttonClass}>
              {submitting ? 'Creating…' : 'Create employee'}
            </button>
            <Link href="/employees" className={secondaryButtonClass}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
