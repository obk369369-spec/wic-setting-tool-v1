"""Single fail-closed customer release boundary; not a semantic-model substitute.

Adapters may supply drafts, never a PASS verdict. Missing semantic execution or
current-customer evidence cannot be converted to PASS by a read receipt.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

CENTRAL = 'obk369369-spec/20-operational-manual-viewer'
ROOT_ID = 'T41-T42-NATIVE-AUTOMATION'
CATEGORIES = ('purpose_exposure', 'sales_pressure', 'too_direct', 'burden',
              'tangled_phrasing', 'current_customer_mismatch',
              'contact_history_mismatch', 'materials_not_verified_first')

def digest(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def normalize(text):
    return re.sub(r'[\W_]+', '', str(text).casefold())

def blocked(reason, **metadata):
    return {'status': 'HOLD', 'reason': reason, 'output_allowed': False,
            'rows': [], 'turns': [], 'phone_message': '', 'email_body': '',
            'guidance_message': '', 'recommendations': [], 'cue_card': {},
            'send_allowed': False, **metadata}

def approved(draft, **metadata):
    """Release only an exact replay of user-corrected canonical evidence."""
    return {'status': 'DRAFT_VALIDATED', 'reason': 'CANONICAL_USER_CORRECTION_REPLAY',
            'output_allowed': True, 'send_allowed': False,
            'turns': draft.get('turns', []),
            'phone_message': draft.get('phone_message', ''),
            'email_body': draft.get('email_body', ''),
            'guidance_message': draft.get('guidance_message', ''),
            'recommendations': draft.get('recommendations', []),
            'cue_card': draft.get('cue_card', {}), **metadata}

def evaluate(payload):
    context = payload.get('context') or {}
    source_hashes = context.get('source_sha256') or {}
    required = ('central_master', 'master', 'checkpoint', 'central_checkpoint', 'feedback', 'customers', 'release_gate')
    missing = [key for key in required if not context.get(key) or source_hashes.get(key) != digest(context[key])]
    if missing:
        return blocked('MASTER_OR_SOURCE_APPLICATION_UNPROVEN', failed_sources=missing)
    if context['release_gate'] != Path(__file__).read_text(encoding='utf-8'):
        return blocked('STALE_RELEASE_GATE_IMPLEMENTATION')
    try:
        feedback = json.loads(context['feedback'])
        cases = feedback['cases']
        feedback_ref = feedback['current_feedback_ref']
    except (ValueError, KeyError, TypeError):
        return blocked('LATEST_FEEDBACK_UNAVAILABLE')
    draft = payload.get('draft') or {}
    draft_text = draft if isinstance(draft, str) else json.dumps(draft, ensure_ascii=False, sort_keys=True)
    comparable = normalize(draft_text)
    rejected = []
    selected = None
    for case in cases:
        phrases = [case.get('old_excerpt'), case.get('additional_wrong_excerpt')]
        if any(phrase and normalize(phrase) in comparable for phrase in phrases):
            rejected.append(case['id'])
            selected = case
    stages = ['CANONICAL_SOURCES_BOUND', 'LATEST_EXPLICIT_FEEDBACK_APPLIED', 'DRAFT_INSPECTED']
    rewritten_hash = None
    if rejected:
        stages.append('USER_EXPLICIT_FAIL_BLOCKED')
        # Reuse an existing correction only. No new policy, invented contact,
        # arbitrary paraphrase loop or regression to the rejected wording.
        if len(rejected) == 1 and selected.get('expected_question'):
            alternate = selected['expected_question']
            rewritten_hash = digest(alternate)
            stages.append('ONE_CANONICAL_ALTERNATIVE_REWRITE')
    # The bounded semantic runtime may promote only an exact, source-bound
    # replay of a question that the user's canonical correction already fixed.
    # It never invents approval and fails closed for every new customer/copy.
    source_ref = draft.get('source_ref') if isinstance(draft, dict) else None
    turns = draft.get('turns', []) if isinstance(draft, dict) else []
    evidence = [case for case in cases if case.get('context', {}).get('source_ref') == source_ref]
    exact = len(evidence) == 1 and evidence[0].get('expected_question') in turns
    semantic = {key: 'PASS_CANONICAL_USER_CORRECTION_REPLAY' if exact else 'HOLD_NOT_EVIDENCED'
                for key in CATEGORIES}
    if exact and not rejected and draft.get('status') == 'DRAFT_VALIDATED':
        stages.extend(('EVIDENCE_BOUND_SEMANTIC_REVIEW_PASS', 'FINAL_RELEASE_GATE_PASS'))
        return approved(draft, feedback_ref=feedback_ref, source_sha256=source_hashes,
                        draft_sha256=digest(draft_text), rejected_case_ids=[], rewrite_count=0,
                        semantic_checks=semantic, stages=stages,
                        customer_e2e='CANONICAL_COPY_ONLY_MATERIAL_OUTPUT_SEPARATE')
    stages.append('FINAL_SEMANTIC_GATE_HOLD')
    return blocked('APPROVED_CUSTOMER_COPY_EVIDENCE_MISSING',
                   preflight_failure=draft.get('reason') if isinstance(draft, dict) and draft.get('status') == 'HOLD' else None,
                   feedback_ref=feedback_ref, source_sha256=source_hashes,
                   draft_sha256=digest(draft_text), rejected_case_ids=rejected,
                   old_rule_regression='BLOCKED_FOR_EXPLICIT_REJECTED_PHRASES_ONLY',
                   rewrite_count=1 if rewritten_hash else 0,
                   rewritten_sha256=rewritten_hash, semantic_checks=semantic,
                   stages=stages, customer_e2e='NOT_PROVEN')

def github(path, method='GET', body=None):
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if not token:
        raise PermissionError('NATIVE_GITHUB_AUTH_UNAVAILABLE')
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
               'User-Agent': 'WIC-customer-release-gate'}
    data = None if body is None else json.dumps(body).encode()
    with urlopen(Request('https://api.github.com/repos/' + path, data=data,
                         headers=headers, method=method), timeout=25) as response:
        return json.load(response)

def save_central(result, transport=github):
    """CAS update of the existing central root, with redacted, bounded receipt.

    Never includes a customer name, address, raw draft, source text or token.
    Failed read-back prevents native-save PASS; conflicts are not retried.
    """
    path = CENTRAL + '/contents/feedback_pipeline/unified_open_ledger.json'
    receipt = {key: result.get(key) for key in ('status', 'reason', 'draft_sha256',
               'rejected_case_ids', 'rewrite_count', 'semantic_checks')}
    receipt['receipt_id'] = digest(receipt)
    try:
        before = transport(path)
        ledger = json.loads(base64.b64decode(before['content']).decode('utf-8'))
        matches = [row for row in ledger['entries'] if row.get('root_id') == ROOT_ID]
        if len(matches) != 1:
            return {'status': 'HOLD', 'reason': 'CENTRAL_ROOT_NOT_UNIQUE'}
        row = matches[0]
        if row.get('native_gate_receipt', {}).get('receipt_id') == receipt['receipt_id']:
            return {'status': 'SKIP_REUSE', 'receipt_id': receipt['receipt_id']}
        row['native_gate_receipt'] = receipt
        row['last_actual_point'] = 'Native customer gate: ' + result['status'] + ' / ' + result['reason']
        content = json.dumps(ledger, ensure_ascii=False, indent=2) + '\n'
        saved = transport(path, 'PUT', {'message': 'checkpoint: native customer release gate outcome',
                          'sha': before['sha'], 'branch': 'main',
                          'content': base64.b64encode(content.encode()).decode()})
        revision = saved['commit']['sha']
        after = transport(path + '?ref=' + revision)
        if base64.b64decode(after['content']).decode('utf-8') != content:
            return {'status': 'HOLD', 'reason': 'CENTRAL_READBACK_MISMATCH'}
        return {'status': 'PASS', 'commit': revision, 'receipt_id': receipt['receipt_id']}
    except Exception as exc:
        return {'status': 'HOLD', 'reason': 'NATIVE_CENTRAL_SAVE_UNAVAILABLE', 'error_type': type(exc).__name__}

def release(payload):
    try:
        result = evaluate(payload)
    except Exception as exc:
        result = blocked('FINAL_GATE_INVALID_INPUT', error_type=type(exc).__name__)
    result['native_central_save'] = save_central(result)
    return result

if __name__ == '__main__':
    try:
        output = release(json.load(sys.stdin))
    except Exception:
        output = blocked('FINAL_GATE_INVALID_INPUT')
    print(json.dumps(output, ensure_ascii=False))
    raise SystemExit(2)
