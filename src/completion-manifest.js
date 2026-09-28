'use strict';

// Deterministic completion-manifest nudge for inventory/backlog/ingestion work.
// Inspired by the Jake Van Clief channel ingestion closeout: a batch is only
// complete when the manifest, processed count, coverage notes, and verification
// agree. Agents should not infer closure from a plausible partial pass.

const BATCH_TERMS = [
  'ingest', 'ingestion', 'process', 'processed', 'backlog', 'queue', 'batch',
  'inventory', 'catalog', 'catalogue', 'archive', 'dataset', 'channel',
  'videos', 'shorts', 'streams', 'records', 'items', 'entries', 'sources'
];

const COMPLETION_TERMS = [
  'complete', 'completed', 'finish', 'finished', 'close', 'closed', 'done',
  'all', 'remaining', 'unprocessed', 'coverage', 'refresh', 'sync', 'reconcile'
];

const TRACKING_TERMS = [
  'manifest', 'index', 'ledger', 'log', 'coverage', 'source coverage',
  'processed count', 'total count', 'counts', 'checklist', 'state file'
];

const EXISTING_FRAME_TERMS = [
  'processed_count', 'processed count', 'total=', 'total count', 'unprocessed=[]',
  'unprocessed list', 'manifest check', 'coverage check', 'reconcile counts',
  'inventory refresh', 'verification command', 'verify_ingestion'
];

function countMatches(text, terms) {
  return terms.reduce(function (count, term) {
    return text.indexOf(term) !== -1 ? count + 1 : count;
  }, 0);
}

function classifyCompletionManifest(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { applies: false, reason: 'empty message', score: 0 };
  }

  const batch = countMatches(text, BATCH_TERMS);
  const completion = countMatches(text, COMPLETION_TERMS);
  const tracking = countMatches(text, TRACKING_TERMS);
  const existingFrame = countMatches(text, EXISTING_FRAME_TERMS);
  const score = (batch * 2) + (completion * 2) + tracking - (existingFrame * 3);

  if (existingFrame >= 2) {
    return { applies: false, reason: 'operator already supplied completion-manifest frame', score };
  }
  if (batch === 0) {
    return { applies: false, reason: 'no batch/inventory signal', score };
  }
  if (completion === 0 && tracking === 0) {
    return { applies: false, reason: 'not asking for closure or manifest reconciliation', score };
  }
  if (score < 5) {
    return { applies: false, reason: 'weak completion-manifest signal', score };
  }

  const layer = tracking >= 2
    ? 'manifest-closeout'
    : 'batch-coverage-check';

  return {
    applies: true,
    reason: 'batch/inventory work needs explicit count reconciliation before closure',
    score,
    layer,
    signals: { batch, completion, tracking, existing_frame: existingFrame }
  };
}

function completionManifestPromptBlock(message) {
  const classification = classifyCompletionManifest(message);
  if (!classification.applies) return '';

  return '[COMPLETION-MANIFEST CHECK]\n'
    + 'This looks like batch, inventory, archive, or ingestion work where a partial pass can look complete. Before claiming closure, reconcile the durable state and then finish the requested work.\n'
    + '- Inventory source: name the manifest, index, queue, API/list command, folder, or source-of-truth used for the total set.\n'
    + '- Count reconciliation: report total, processed/done, remaining/unprocessed, skipped/low-signal, and any mismatch between declared counts and files/rows.\n'
    + '- Coverage notes: mark low-signal, unavailable, duplicate, failed, or intentionally skipped items without turning them into fake findings.\n'
    + '- State update: update the durable manifest/log/index/coverage artifact that the next run will read, not just the chat response.\n'
    + '- Verification: run the parser/schema/count check or equivalent command and include the exact output that proves no items were silently missed.\n'
    + 'If the inventory cannot be refreshed, say that plainly and record the last verified state.\n'
    + '[/COMPLETION-MANIFEST CHECK]';
}

function appendCompletionManifestPrompt(message) {
  const block = completionManifestPromptBlock(message);
  if (!block) return String(message || '');
  return String(message || '') + '\n\n' + block;
}

module.exports = {
  classifyCompletionManifest,
  completionManifestPromptBlock,
  appendCompletionManifestPrompt
};
