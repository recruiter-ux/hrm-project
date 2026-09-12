'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
import type { EmployeeDetail, FormOptions } from '@/lib/types';

const CHANGE_REASONS = [
  'PROMOTION',
  'DEMOTION',
  'LATERAL_MOVE',
  'DEPARTMENT_TRANSFER',
  'MANAGER_CHANGE',
  'EMPLOYMENT_TYPE_CHANGE',
  'WORK_LOCATION_CHANGE',
  'REORGANISATION',
  'DATA_CORRECTION',
] as const;

export default function EditEmployeePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [personal, setPersonal] = useState({
    firstName: '',
    lastName: '',
    preferredName: '',
    workEmail: '',
    personalEmail: '',
    phoneNumber: '',
    timezone: '',
    workingTitle: '',
    status: 'ACTIVE',
  });

  /** The job-change block is opt-in — most edits are just a phone number. */
  const [changingJob, setChangingJob] = useState(false);
  const [job, setJob] = useState({
    roleId: '',
    departmentId: '',
    managerId: '',
    employmentType: 'FULL_TIME',
    workLocationType: 'ONSITE',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    reason: 'PROMOTION',
    notes: '',
  });

  useEffect(() => {
    void (async () => {
      try {
        const [emp, opts] = await Promise.all([
          api<EmployeeDetail>(`/api/employees/${id}`),
          api<FormOptions>('/api/employees/options'),
        ]);
        setEmployee(emp);
        setOptions(opts);
        setPersonal({
          firstName: emp.firstName,
          lastName: emp.lastName,
          preferredName: emp.preferredName ?? '',
          workEmail: emp.workEmail,
          personalEmail: emp.personalEmail ?? '',
          phoneNumber: emp.phoneNumber ?? '',
          timezone: emp.timezone,
          workingTitle: emp.workingTitle ?? '',
          status: emp.status,
        });
        setJob((prev) => ({
          ...prev,
          roleId: emp.role?.id ?? '',
          departmentId: emp.department?.id ?? '',
          managerId: emp.manager?.id ?? '',
          employmentType: emp.employmentType,
          workLocationType: emp.workLocationType,
        }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load this employee.');
      }
    })();
  }, [id]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        firstName: personal.firstName.trim(),
        lastName: personal.lastName.trim(),
        preferredName: personal.preferredName.trim() || undefined,
        workEmail: personal.workEmail.trim(),
        personalEmail: personal.personalEmail.trim() || undefined,
        phoneNumber: personal.phoneNumber.trim() || undefined,
        timezone: personal.timezone.trim() || undefined,
        workingTitle: personal.workingTitle.trim() || undefined,
        status: personal.status,
      };

      // The five job fields are only ever sent inside `assignment`. Sending any
      // of them at the top level would be rejected by the API with a 400 —
      // that is deliberate, and it is what protects the employment history.
      if (changingJob) {
        body.assignment = {
          roleId: job.roleId,
          departmentId: job.departmentId,
          managerId: job.managerId || null,
          employmentType: job.employmentType,
          workLocationType: job.workLocationType,
          effectiveFrom: new Date(job.effectiveFrom).toISOString(),
          reason: job.reason,
          notes: job.notes.trim() || undefined,
        };
      }

      await api(`/api/employees/${id}`, { method: 'PATCH', body });
      router.push(`/employees/${id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? []);
      } else {
        setError('Could not save changes.');
      }
      setSubmitting(false);
    }
  }

  if (error && !employee) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <Link href="/employees" className="text-sm underline underline-offset-2">
          Back to employees
        </Link>
      </div>
    );
  }

  if (!employee || !options) return <Spinner />;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href={`/employees/${id}`}
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          ← Back to profile
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          Edit {employee.preferredName ?? employee.firstName} {employee.lastName}
        </h1>
      </div>

      {error && <ErrorBanner message={error} />}
      {details.length > 1 && (
        <ul className="list-inside list-disc rounded-md border border-[var(--border)] p-3 text-sm text-[var(--muted)]">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Personal details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <input
                value={personal.firstName}
                onChange={(e) => setPersonal({ ...personal, firstName: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Last name" required>
              <input
                value={personal.lastName}
                onChange={(e) => setPersonal({ ...personal, lastName: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Preferred name">
              <input
                value={personal.preferredName}
                onChange={(e) => setPersonal({ ...personal, preferredName: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Work email" required>
              <input
                type="email"
                value={personal.workEmail}
                onChange={(e) => setPersonal({ ...personal, workEmail: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Personal email">
              <input
                type="email"
                value={personal.personalEmail}
                onChange={(e) => setPersonal({ ...personal, personalEmail: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Phone">
              <input
                value={personal.phoneNumber}
                onChange={(e) => setPersonal({ ...personal, phoneNumber: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Timezone">
              <input
                value={personal.timezone}
                onChange={(e) => setPersonal({ ...personal, timezone: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Working title" hint="Free-text override of the job title">
              <input
                value={personal.workingTitle}
                onChange={(e) => setPersonal({ ...personal, workingTitle: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Status">
              <select
                value={personal.status}
                onChange={(e) => setPersonal({ ...personal, status: e.target.value })}
                className={inputClass}
              >
                {[
                  'PROBATION',
                  'ACTIVE',
                  'ON_LEAVE',
                  'NOTICE_PERIOD',
                  'SUSPENDED',
                  'TERMINATED',
                ].map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-[var(--border)] p-5">
          <div>
            <h2 className="text-lg font-semibold">Job title, department, or manager</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              These five fields are not edited directly. Changing any of them closes the current
              employment record and opens a new one, so the person&rsquo;s history stays intact —
              which is why a date and a reason are required.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={changingJob}
              onChange={(e) => setChangingJob(e.target.checked)}
            />
            Record a job change
          </label>

          {changingJob && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job title (Role)" required>
                <select
                  value={job.roleId}
                  onChange={(e) => setJob({ ...job, roleId: e.target.value })}
                  required
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {options.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department" required>
                <select
                  value={job.departmentId}
                  onChange={(e) => setJob({ ...job, departmentId: e.target.value })}
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
              <Field label="Manager">
                <select
                  value={job.managerId}
                  onChange={(e) => setJob({ ...job, managerId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">No manager</option>
                  {options.managers
                    .filter((m) => m.id !== id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.firstName} {m.lastName} ({m.employeeNumber})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Employment type">
                <select
                  value={job.employmentType}
                  onChange={(e) => setJob({ ...job, employmentType: e.target.value })}
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
                  value={job.workLocationType}
                  onChange={(e) => setJob({ ...job, workLocationType: e.target.value })}
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
                label="Effective from"
                required
                hint="Must be after the current record started"
              >
                <input
                  type="date"
                  value={job.effectiveFrom}
                  onChange={(e) => setJob({ ...job, effectiveFrom: e.target.value })}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Reason" required>
                <select
                  value={job.reason}
                  onChange={(e) => setJob({ ...job, reason: e.target.value })}
                  required
                  className={inputClass}
                >
                  {CHANGE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, ' ').toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Notes" hint="Context a dropdown cannot capture">
                <input
                  value={job.notes}
                  onChange={(e) => setJob({ ...job, notes: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </section>

        <div className="flex gap-3">
          <button type="submit" disabled={submitting} className={buttonClass}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link href={`/employees/${id}`} className={secondaryButtonClass}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
