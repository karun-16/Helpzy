import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { REPORT_STATUSES } from '@helpzy/types';

import {
  ActionButton,
  InlineError,
  InlineSuccess,
  LoadingBlock,
  formatDateTime,
} from '@/components/marketplace-ui';
import { StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Report = Awaited<ReturnType<typeof api.admin.reports>>[number];

const REASON_LABELS: Record<string, string> = {
  INAPPROPRIATE_CONTENT: 'Inappropriate content',
  FRAUD_OR_SCAM: 'Fraud or scam',
  HARASSMENT: 'Harassment or abuse',
  MISLEADING_LISTING: 'Misleading listing',
  UNSAFE_OR_UNPROFESSIONAL: 'Unsafe or unprofessional',
  NO_SHOW: 'No show',
  PAYMENT_ISSUE: 'Payment issue',
  OTHER: 'Other',
};

const ACTION_LABELS: Record<string, string> = {
  LISTING_WITHDRAWN: 'Listing withdrawn',
  ACCOUNT_SUSPENDED: 'Account suspended',
  CONTENT_REMOVED: 'Content removed',
  NO_ACTION_NEEDED: 'No action needed',
  REFUND_ISSUED: 'Refund issued',
};

type Filter = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED' | 'ALL';

/**
 * Admin triage of customer reports.
 *
 * Closing a report requires a note, because the reporter is told the outcome and
 * a report closed in silence reads to them exactly like being ignored. The note
 * is separate from the action taken so "we looked and it was fine" is a
 * first-class outcome rather than an empty decision.
 */
export function AdminReportsPanel() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState<string>('LISTING_WITHDRAWN');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSeq = useRef(0);

  const load = useCallback((activeFilter: Filter) => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    api.admin
      .reports(activeFilter === 'ALL' ? {} : { status: activeFilter })
      .then((result) => {
        if (loadSeq.current === seq) setReports(result);
      })
      .catch(() => {
        if (loadSeq.current === seq) setError('Could not load reports.');
      });
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const noteValid = note.trim().length >= 10;

  const startReview = async (report: Report) => {
    if (busy) return;
    setBusy(report.id);
    setError('');
    setNotice('');
    try {
      await api.admin.startReportReview(report.id);
      setNotice(`You are now reviewing the report about ${report.targetLabel}.`);
      load(filter);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not claim the report.',
      );
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (report: Report, status: 'RESOLVED' | 'DISMISSED') => {
    if (busy || !noteValid) return;
    setBusy(report.id);
    setError('');
    setNotice('');
    try {
      await api.admin.resolveReport(report.id, {
        status,
        resolutionNote: note.trim(),
        resolutionAction: action,
      });
      setNotice(
        status === 'RESOLVED'
          ? `Report closed as upheld. ${report.targetOwner.fullName} and the reporter have both been told.`
          : 'Report closed as dismissed. The reporter has been told.',
      );
      setOpenId(null);
      setNote('');
      load(filter);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not close the report.',
      );
    } finally {
      setBusy(null);
    }
  };

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'OPEN', label: 'Open' },
    { key: 'UNDER_REVIEW', label: 'Being reviewed' },
    { key: 'RESOLVED', label: 'Upheld' },
    { key: 'DISMISSED', label: 'Dismissed' },
    { key: 'ALL', label: 'All' },
  ];

  return (
    <View className="mt-8">
      <Text className="text-xl font-bold text-primary">Reports</Text>
      <Text className="mt-1 text-sm text-secondary">
        Every report arrives here with the person it is about. Closing one always tells the reporter
        what was decided.
      </Text>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {filters.map((entry) => {
          const selected = entry.key === filter;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityLabel={`Show ${entry.label} reports`}
              accessibilityState={{ selected }}
              onPress={() => setFilter(entry.key)}
              className={`min-h-9 justify-center rounded-lg border px-3 ${
                selected
                  ? 'border-action-text bg-surface-muted'
                  : 'border-hairline-strong bg-surface'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  selected ? 'text-action-text' : 'text-secondary'
                }`}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {reports === null ? (
        <LoadingBlock label="Loading reports..." />
      ) : reports.length === 0 ? (
        <Text className="mt-4 text-sm text-secondary">No reports in this view.</Text>
      ) : (
        <View className="mt-4 gap-3">
          {reports.map((report) => {
            const closed =
              report.status === REPORT_STATUSES.RESOLVED ||
              report.status === REPORT_STATUSES.DISMISSED;
            const isOpen = openId === report.id;

            return (
              <View
                key={report.id}
                className="rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong"
              >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-48 flex-1">
                    <Text className="font-bold text-primary">{report.targetLabel}</Text>
                    <Text className="mt-1 text-sm text-secondary">
                      {REASON_LABELS[report.reason] ?? report.reason} · about{' '}
                      {report.targetOwner.fullName} · filed by {report.reporter.fullName}
                    </Text>
                    <Text className="mt-1 text-xs text-tertiary">
                      {formatDateTime(report.createdAt)}
                    </Text>
                  </View>
                  <StatusBadge
                    label={
                      closed
                        ? report.status
                        : report.status === 'UNDER_REVIEW'
                          ? 'Reviewing'
                          : 'Open'
                    }
                    tone={closed ? 'neutral' : 'pending'}
                  />
                </View>

                <Text className="mt-3 text-sm leading-5 text-primary">{report.description}</Text>

                {report.resolutionNote ? (
                  <View className="mt-3 rounded-lg border border-hairline bg-surface-muted p-3">
                    <Text className="text-xs font-bold uppercase tracking-wide text-secondary">
                      {report.status === REPORT_STATUSES.RESOLVED ? 'Upheld' : 'Dismissed'}
                      {report.resolutionAction
                        ? ` · ${ACTION_LABELS[report.resolutionAction] ?? report.resolutionAction}`
                        : ''}
                    </Text>
                    <Text className="mt-1 text-sm text-primary">{report.resolutionNote}</Text>
                  </View>
                ) : null}

                {!closed ? (
                  isOpen ? (
                    <View className="mt-3 gap-3">
                      <View className="gap-2">
                        <Text className="text-sm font-semibold text-primary">
                          What did you do about it?
                        </Text>
                        <View className="flex-row flex-wrap gap-2">
                          {Object.entries(ACTION_LABELS).map(([value, label]) => {
                            const selected = value === action;
                            return (
                              <Pressable
                                key={value}
                                accessibilityRole="button"
                                accessibilityLabel={label}
                                accessibilityState={{ selected }}
                                onPress={() => setAction(value)}
                                className={`min-h-9 justify-center rounded-lg border px-3 ${
                                  selected
                                    ? 'border-action-text bg-surface-muted'
                                    : 'border-hairline-strong bg-surface'
                                }`}
                              >
                                <Text
                                  className={`text-xs font-semibold ${
                                    selected ? 'text-action-text' : 'text-secondary'
                                  }`}
                                >
                                  {label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>

                      <TextInput
                        accessibilityLabel="Note to the reporter"
                        value={note}
                        onChangeText={setNote}
                        placeholder="Explain the outcome. The reporter will read this."
                        placeholderTextColor="#94a3b8"
                        multiline
                        className="min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
                      />
                      <Text className="text-xs text-secondary">
                        At least 10 characters. This is sent to the person who reported it.
                      </Text>

                      <View className="flex-row flex-wrap gap-3">
                        <ActionButton
                          label="Close as upheld"
                          onPress={() => resolve(report, 'RESOLVED')}
                          busy={busy === report.id}
                          disabled={busy !== null || !noteValid}
                        />
                        <ActionButton
                          label="Dismiss"
                          tone="subtle"
                          onPress={() => resolve(report, 'DISMISSED')}
                          busy={busy === report.id}
                          disabled={busy !== null || !noteValid}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Cancel"
                          onPress={() => setOpenId(null)}
                          disabled={busy !== null}
                          className="min-h-11 justify-center px-2"
                        >
                          <Text className="text-sm font-semibold text-secondary">Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View className="mt-3 flex-row flex-wrap gap-4">
                      {report.status === REPORT_STATUSES.OPEN ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Start reviewing this report"
                          disabled={busy !== null}
                          onPress={() => startReview(report)}
                        >
                          <Text className="text-sm font-semibold text-action-text">
                            {busy === report.id ? 'Working...' : 'Start reviewing'}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close this report"
                        disabled={busy !== null}
                        onPress={() => {
                          setOpenId(report.id);
                          setNote('');
                          setError('');
                          setNotice('');
                        }}
                      >
                        <Text className="text-sm font-semibold text-action-text">Close report</Text>
                      </Pressable>
                    </View>
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      <InlineError message={error} />
      <InlineSuccess message={notice} />
    </View>
  );
}
