import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Pencil, RotateCcw, Trophy, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { dealsApi, lostReasonsApi, pipelinesApi, productsApi } from '@/api/deals';
import { contactsApi } from '@/api/contacts';
import { ActivitiesPanel } from '@/components/shared/ActivitiesPanel';
import { CustomFieldsSummary } from '@/components/shared/CustomFieldsEditor';
import { NotesPanel } from '@/components/shared/NotesPanel';
import { TagManager } from '@/components/shared/TagManager';
import { TimelinePanel } from '@/components/shared/TimelinePanel';
import {
  Badge, BackIcon, Button, Card, CardBody, CardHeader, EmptyState, FormField, Input, Modal, Select,
  Spinner, Textarea, toast, type BadgeColor,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, fullName } from '@/lib/utils';
import type { DealStatus } from '@/types';

import { DealFormModal } from './DealFormModal';

const statusColors: Record<DealStatus, BadgeColor> = { open: 'blue', won: 'green', lost: 'red', abandoned: 'gray' };
function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div className="grid grid-cols-[minmax(8rem,1fr)_2fr] gap-4 py-2 text-sm"><dt className="text-gray-500">{label}</dt><dd dir="auto" className="text-end font-medium">{value ?? 'Not set'}</dd></div>;
}

export function DealDetailPage() {
  const id = Number(useParams<{ id: string }>().id);
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [outcome, setOutcome] = useState<'won' | 'lost' | 'abandoned' | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostDetails, setLostDetails] = useState('');
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const [lineItemOpen, setLineItemOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [participant, setParticipant] = useState({ contact: '', role: 'other', is_primary: false });
  const [line, setLine] = useState({ product: '', name: '', quantity: '1', unit_price: '', discount_type: 'none', discount_value: '0' });
  const { data: deal, isLoading, isError } = useQuery({ queryKey: ['deals', id], queryFn: () => dealsApi.get(id), enabled: Number.isFinite(id) });
  const { data: pipelines } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list });
  const { data: reasons } = useQuery({ queryKey: ['lost-reasons'], queryFn: lostReasonsApi.list });
  const { data: products } = useQuery({ queryKey: ['products', 'options'], queryFn: () => productsApi.list({ page_size: 100, active: true }) });
  const { data: contacts } = useQuery({ queryKey: ['contacts', 'deal-options'], queryFn: () => contactsApi.list({ page_size: 100 }), enabled: contactOpen });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['deals'] });
  const transition = useMutation({
    mutationFn: async () => {
      if (!deal) throw new Error('Deal unavailable');
      if (outcome === 'won') return dealsApi.markWon(id, { actual_close_date: closeDate, expected_version: deal.version });
      const payload = { lost_reason: lostReason ? Number(lostReason) : undefined, lost_reason_text: lostDetails, expected_version: deal.version };
      return outcome === 'abandoned' ? dealsApi.markAbandoned(id, payload) : dealsApi.markLost(id, payload);
    },
    onSuccess: () => { setOutcome(null); invalidate(); toast.success('Deal updated'); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const reopen = useMutation({
    mutationFn: () => {
      const stage = deal?.pipeline_detail.stages.find((item) => item.stage_type === 'open');
      if (!deal || !stage) throw new Error('Pipeline has no open stage');
      return dealsApi.reopen(id, stage.id, deal.version);
    }, onSuccess: () => { invalidate(); toast.success('Deal reopened'); }, onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: () => deal?.archived_at ? dealsApi.restore(id) : dealsApi.archive(id),
    onSuccess: () => { invalidate(); toast.success('Deal updated'); }, onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const move = useMutation({
    mutationFn: (stage: number) => dealsApi.movePipeline(id, stage, deal?.version),
    onSuccess: () => { invalidate(); toast.success('Deal moved'); }, onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const addLine = useMutation({
    mutationFn: () => dealsApi.addLineItem(id, {
      product: line.product ? Number(line.product) : null, name_snapshot: line.name,
      quantity: line.quantity, unit_price: line.unit_price || undefined,
      discount_type: line.discount_type as 'none' | 'fixed' | 'percent', discount_value: line.discount_value,
    }),
    onSuccess: () => { setLineItemOpen(false); invalidate(); toast.success('Line item added'); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const removeLine = useMutation({ mutationFn: (item: number) => dealsApi.removeLineItem(id, item), onSuccess: invalidate, onError: (error) => toast.error(apiErrorMessage(error)) });
  const addContact = useMutation({
    mutationFn: () => dealsApi.addContact(id, { contact: Number(participant.contact), role: participant.role as 'other', is_primary: participant.is_primary }),
    onSuccess: () => { setContactOpen(false); invalidate(); }, onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const removeContact = useMutation({ mutationFn: (participantId: number) => dealsApi.removeContact(id, participantId), onSuccess: invalidate, onError: (error) => toast.error(apiErrorMessage(error)) });

  if (isLoading) return <div className="flex justify-center py-24"><Spinner className="h-8 w-8 text-primary-600" /></div>;
  if (isError || !deal) return <EmptyState title="Deal not found" description="It may be archived or unavailable to your tenant." />;
  const openStages = deal.pipeline_detail.stages.filter((stage) => stage.stage_type === 'open' || stage.stage_type === 'on_hold');

  return <div>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <Link to="/app/deals" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Back to Deals"><BackIcon /></Link>
        <div><div className="flex flex-wrap items-center gap-2"><h1 dir="auto" className="text-2xl font-bold">{deal.title}</h1><Badge color={statusColors[deal.status]}>{deal.status}</Badge></div>
          <p className="mt-1 text-sm text-gray-500">{deal.pipeline_detail.name} · {deal.stage_detail.name} · {deal.owner_detail ? fullName(deal.owner_detail) : 'Unassigned'}</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {deal.status === 'open' ? <><Button variant="ghost" onClick={() => setOutcome('abandoned')}>Abandon</Button><Button variant="outline" onClick={() => setOutcome('lost')}><XCircle className="h-4 w-4" />Mark lost</Button><Button onClick={() => setOutcome('won')}><Trophy className="h-4 w-4" />Mark won</Button></> : <Button onClick={() => reopen.mutate()} loading={reopen.isPending}><RotateCcw className="h-4 w-4" />Reopen</Button>}
        <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" />Edit</Button>
        <Button variant="ghost" onClick={() => archive.mutate()} loading={archive.isPending}><Archive className="h-4 w-4" />{deal.archived_at ? 'Restore' : 'Archive'}</Button>
      </div>
    </div>
    {deal.is_stale && <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />This Deal needs attention: {deal.stale_reasons.join(', ').replace(/_/g, ' ')}.</div>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
      <div className="space-y-5">
        <Card><CardHeader title="Commercial overview" /><CardBody><dl className="divide-y divide-line">
          <Row label="Amount" value={formatCurrency(deal.value, deal.currency)} /><Row label="Weighted value" value={formatCurrency(deal.weighted_value, deal.currency)} />
          <Row label="Probability" value={`${deal.probability}%`} /><Row label="Priority" value={deal.priority} />
          <Row label="Expected close" value={formatDate(deal.expected_close_date)} /><Row label="Actual close" value={formatDate(deal.actual_close_date)} />
          <Row label="Next activity" value={deal.next_activity_id ? `${deal.next_activity_title} · ${deal.next_activity_all_day ? formatDate(deal.next_activity_due_date) : formatDateTime(deal.next_activity_at)}` : 'No next activity scheduled'} />
          <Row label="Company" value={deal.company_detail?.name} /><Row label="Primary contact" value={deal.contact_detail ? fullName(deal.contact_detail) : null} />
          <Row label="Age" value={`${deal.age_days} days · ${deal.stage_age_days} in current stage`} />
          {deal.lost_reason_detail && <Row label="Lost reason" value={`${deal.lost_reason_detail.label}${deal.lost_reason_text ? `: ${deal.lost_reason_text}` : ''}`} />}
        </dl><div className="mt-4"><CustomFieldsSummary values={deal.custom_fields} /></div></CardBody></Card>
        <Card><CardHeader title="Products and line items" actions={<Button size="sm" onClick={() => setLineItemOpen(true)}>Add line item</Button>} /><CardBody>
          {!deal.line_items.length ? <p className="text-sm text-gray-500">No products added. Manual Deal value remains authoritative.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-start text-xs uppercase text-gray-500"><th className="py-2">Item</th><th>Quantity</th><th>Unit price</th><th>Total</th><th /></tr></thead><tbody>{deal.line_items.map((item) => <tr key={item.id} className="border-b border-line"><td className="py-3"><p className="font-medium">{item.name_snapshot}</p><p className="text-xs text-gray-500">{item.sku_snapshot}</p></td><td>{item.quantity}</td><td>{formatCurrency(item.unit_price, deal.currency)}</td><td>{formatCurrency(item.line_total, deal.currency)}</td><td><Button size="sm" variant="ghost" onClick={() => removeLine.mutate(item.id)}>Remove</Button></td></tr>)}</tbody></table></div>}
        </CardBody></Card>
        <NotesPanel related={{ deal: id }} /><ActivitiesPanel related={{ deal: id }} /><TimelinePanel type="deal" id={id} />
      </div>
      <aside className="space-y-5">
        <Card><CardHeader title="Move Deal" /><CardBody><FormField label="Pipeline and stage"><Select value="" onChange={(event) => event.target.value && move.mutate(Number(event.target.value))}><option value="">Select destination</option>{pipelines?.map((pipeline) => <optgroup key={pipeline.id} label={pipeline.name}>{pipeline.stages.filter((stage) => stage.stage_type === 'open' || stage.stage_type === 'on_hold').map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</optgroup>)}</Select></FormField>
          {openStages.length > 1 && <div className="mt-3 flex flex-wrap gap-2">{openStages.map((stage) => <Button key={stage.id} size="sm" variant={stage.id === deal.stage ? 'secondary' : 'outline'} disabled={stage.id === deal.stage} onClick={() => move.mutate(stage.id)}>{stage.name}</Button>)}</div>}</CardBody></Card>
        <TagManager type="deal" id={id} tags={deal.tags_detail} />
        <Card><CardHeader title="Deal contacts" actions={<Button size="sm" variant="outline" onClick={() => setContactOpen(true)}>Add contact</Button>} /><CardBody>{deal.participants.length ? <ul className="space-y-3">{deal.participants.map((item) => <li key={item.id} className="flex items-start justify-between gap-2"><div><p className="font-medium">{fullName(item.contact_detail)}</p><p className="text-xs text-gray-500">{item.role.replace(/_/g, ' ')}{item.is_primary ? ' · Primary' : ''}</p></div><Button size="sm" variant="ghost" onClick={() => removeContact.mutate(item.id)}>Remove</Button></li>)}</ul> : <p className="text-sm text-gray-500">No Deal contacts attached.</p>}</CardBody></Card>
      </aside>
    </div>
    <DealFormModal open={editOpen} onClose={() => setEditOpen(false)} deal={deal} />
    <Modal open={Boolean(outcome)} onClose={() => setOutcome(null)} title={outcome === 'won' ? 'Mark Deal as won' : outcome === 'abandoned' ? 'Abandon Deal' : 'Mark Deal as lost'} footer={<><Button variant="outline" onClick={() => setOutcome(null)}>Cancel</Button><Button onClick={() => transition.mutate()} loading={transition.isPending} disabled={outcome !== 'won' && deal.pipeline_detail.require_lost_reason && !lostReason}>Confirm</Button></>}>
      {outcome === 'won' ? <FormField label="Actual close date"><Input type="date" value={closeDate} onChange={(event) => setCloseDate(event.target.value)} /></FormField> : <div className="space-y-4"><FormField label="Lost reason" required={deal.pipeline_detail.require_lost_reason}><Select value={lostReason} onChange={(event) => setLostReason(event.target.value)}><option value="">Select a reason</option>{reasons?.results.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}</Select></FormField><FormField label="Additional details"><Textarea value={lostDetails} onChange={(event) => setLostDetails(event.target.value)} /></FormField></div>}
    </Modal>
    <Modal open={lineItemOpen} onClose={() => setLineItemOpen(false)} title="Add line item" footer={<><Button variant="outline" onClick={() => setLineItemOpen(false)}>Cancel</Button><Button onClick={() => addLine.mutate()} loading={addLine.isPending} disabled={!line.product && !line.name.trim()}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2"><FormField label="Product"><Select value={line.product} onChange={(event) => { const product = products?.results.find((item) => item.id === Number(event.target.value)); setLine((current) => ({ ...current, product: event.target.value, name: product?.name ?? current.name, unit_price: product?.default_price ?? current.unit_price })); }}><option value="">Custom item</option>{products?.results.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select></FormField><FormField label="Name" required><Input value={line.name} onChange={(event) => setLine({ ...line, name: event.target.value })} /></FormField><FormField label="Quantity"><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setLine({ ...line, quantity: event.target.value })} /></FormField><FormField label="Unit price"><Input type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => setLine({ ...line, unit_price: event.target.value })} /></FormField><FormField label="Discount"><Select value={line.discount_type} onChange={(event) => setLine({ ...line, discount_type: event.target.value })}><option value="none">None</option><option value="fixed">Fixed</option><option value="percent">Percentage</option></Select></FormField><FormField label="Discount value"><Input type="number" min="0" value={line.discount_value} onChange={(event) => setLine({ ...line, discount_value: event.target.value })} /></FormField></div>
    </Modal>
    <Modal open={contactOpen} onClose={() => setContactOpen(false)} title="Add Deal contact" footer={<><Button variant="outline" onClick={() => setContactOpen(false)}>Cancel</Button><Button onClick={() => addContact.mutate()} loading={addContact.isPending} disabled={!participant.contact}>Add</Button></>}>
      <div className="space-y-4"><FormField label="Contact" required><Select value={participant.contact} onChange={(event) => setParticipant({ ...participant, contact: event.target.value })}><option value="">Select contact</option>{contacts?.results.map((contact) => <option key={contact.id} value={contact.id}>{fullName(contact)}</option>)}</Select></FormField><FormField label="Role"><Select value={participant.role} onChange={(event) => setParticipant({ ...participant, role: event.target.value })}>{['primary', 'decision_maker', 'champion', 'influencer', 'billing', 'technical', 'other'].map((role) => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}</Select></FormField><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={participant.is_primary} onChange={(event) => setParticipant({ ...participant, is_primary: event.target.checked })} />Primary contact</label></div>
    </Modal>
  </div>;
}
