// Lists every field the extension knows about, and how to recognise each one on the page.
/**
 * Canonical field definitions. This is the ONLY place in the codebase where a
 * field's identity is described. Adapters and fill policy take resolved
 * controls and values; they never contain a selector or a field name lookup.
 *
 * To support a new field: add an entry here. Nothing else changes.
 *
 * fieldTypes  TDX's own data-fieldtype markers (tier 1). Near-certain.
 * fieldIds    TDX attribute ids, stable instance-wide (tier 2).
 * labels      Exact label texts (tier 3, weight 1.0).
 * patterns    Regexes tested against label, name, id, placeholder (tier 3).
 * options     Known option strings. A select carrying these is this field
 *             regardless of its label — often the strongest signal available.
 * fixedValue  A constant this field is always written with, when writable.
 * neverWrite  Resolve and report, but never pass a value. Safety, not scope.
 */

import type { FieldDef } from '../types.ts';

export const DICTIONARY: FieldDef[] = [
  {
    key: 'requestor',
    label: 'Requestor',
    control: 'lookup',
    fieldTypes: ['requestor'],
    fieldIds: ['495'],
    labels: ['Who is this request for?', 'Requestor'],
    patterns: [/requestor/i, /who is this request for/i, /contactu?id/i],
    options: [],
  },
  {
    key: 'department',
    label: 'Department',
    control: 'lookup',
    fieldTypes: ['acct/dept'],
    fieldIds: ['38'],
    labels: ['Department', 'Account/Department', 'Acct/Dept'],
    patterns: [/\bdepartment\b/i, /acct\s*\/\s*dept/i, /accountid/i],
    options: [],
  },
  {
    key: 'alternativeContact',
    label: 'Alternative Contact',
    control: 'lookup',
    fieldTypes: ['contact'],
    fieldIds: ['1269'],
    labels: ['Alternative Contact (optional)', 'Alternative Contact'],
    patterns: [/alternative contact/i, /contactuidstr/i],
    options: [],
  },
  {
    key: 'affiliation',
    label: 'Affiliation',
    control: 'select',
    fieldTypes: [],
    fieldIds: ['2706'],
    labels: ['Affiliation'],
    patterns: [/affiliation/i],
    options: ['Alumnus', 'Applicant', 'Faculty', 'Parent', 'Retiree', 'Staff', 'Student', 'Visitor', 'Volunteer'],
    // A person can be a student, an employee, or both. A wrong affiliation
    // misroutes the ticket, so it is never inferred and never written.
    neverWrite: true,
  },
  {
    key: 'ubitName',
    label: 'UBITName',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2445'],
    labels: ['UBITName', 'UBIT Name'],
    patterns: [/ubit\s*name/i],
    options: [],
  },
  {
    key: 'briefSummary',
    label: 'Brief Summary',
    control: 'text',
    fieldTypes: ['title'],
    fieldIds: ['37'],
    labels: ['Brief Summary', 'Title', 'Summary'],
    patterns: [/brief summary/i, /^title$/i, /^summary$/i],
    options: [],
  },
  {
    key: 'description',
    label: 'Description',
    control: 'richtext',
    fieldTypes: ['description'],
    fieldIds: ['138'],
    labels: ['Description', 'Details'],
    patterns: [/description/i, /^details$/i],
    options: [],
  },
  {
    key: 'location',
    label: 'Location',
    control: 'lookup',
    fieldTypes: ['location'],
    fieldIds: ['701'],
    labels: ['Location', 'Building'],
    patterns: [/^location$/i, /^building$/i, /locationid/i],
    options: [],
  },
  {
    key: 'locationRoom',
    label: 'Location Room',
    control: 'lookup',
    fieldTypes: ['location_room'],
    fieldIds: ['702'],
    labels: ['Location Room', 'Room'],
    patterns: [/location\s*room/i, /^room$/i, /locationroomid/i],
    options: [],
  },
  {
    key: 'deviceType',
    label: 'Device type',
    control: 'select',
    fieldTypes: [],
    fieldIds: ['2751'],
    labels: ['Device type', 'Device Type'],
    patterns: [/device\s*type/i],
    options: ['Desktop', 'IoT Device', 'Laptop', 'Phone - Android', 'Phone - iPhone', 'Tablet', 'Other'],
  },
  {
    key: 'macAddress',
    label: 'MAC Address',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2455'],
    labels: ['MAC Address'],
    patterns: [/mac\s*address/i],
    options: [],
  },
  {
    key: 'ipAddress',
    label: 'IP Address',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2757'],
    labels: ['IP Address'],
    patterns: [/\bip\s*address\b/i],
    options: [],
  },
  {
    key: 'operatingSystem',
    label: 'Operating System',
    control: 'select',
    fieldTypes: [],
    fieldIds: ['2616'],
    labels: ['Operating System', 'OS'],
    patterns: [/operating\s*system/i, /^os$/i],
    options: ['Android OS (mobile)', 'Apple iOS (mobile)', 'Linux', 'Mac', 'Windows', 'Other'],
  },
  {
    key: 'osVersion',
    label: 'OS Version',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2624'],
    labels: ['OS Version'],
    patterns: [/os\s*version/i],
    options: [],
  },
  {
    key: 'assetId',
    label: 'Asset ID',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['3224'],
    labels: ['Asset ID', 'Asset Tag'],
    patterns: [/asset\s*(id|tag)/i],
    options: [],
  },
  {
    key: 'additionalInformation',
    label: 'Additional Information',
    control: 'text',
    fieldTypes: [],
    fieldIds: ['2390'],
    labels: ['Additional Information'],
    patterns: [/additional information/i],
    options: [],
  },
  {
    key: 'status',
    label: 'Status',
    control: 'select',
    fieldTypes: ['status'],
    fieldIds: ['40'],
    labels: ['Status'],
    patterns: [/^status$/i],
    options: ['New', 'In Process', 'On Hold', 'Scheduled', 'Waiting for Customer', 'Resolved', 'Closed', 'Cancelled'],
  },
  {
    key: 'responsible',
    label: 'Responsible',
    control: 'lookup',
    fieldTypes: ['responsible'],
    fieldIds: ['1279'],
    labels: ['Responsible', 'Responsible Group', 'Responsibility'],
    patterns: [/responsib/i],
    options: [],
  },
  {
    key: 'source',
    label: 'Source',
    control: 'select',
    fieldTypes: ['source'],
    fieldIds: ['371'],
    labels: ['Source'],
    patterns: [/^source$/i],
    options: [
      'API/Automation', 'Chat/Messaging', 'Chatbot-LiveAgent', 'Client Portal',
      'Email', 'Event/Monitoring', 'Internal Work', 'Operations Check',
      'Personal Visit', 'Phone', 'Self/Own Observation', 'SPAM/Erroneous',
      'Testing', 'Walkup',
    ],
    // Every walk-up ticket has the same source. Verified against the live
    // option list: the string is "Walkup", not "Walk In".
    fixedValue: 'Walkup',
  },
  {
    key: 'impact',
    label: 'Impact',
    control: 'select',
    fieldTypes: ['impact'],
    fieldIds: ['369'],
    labels: ['Impact'],
    patterns: [/^impact$/i],
    options: [
      'Low - Affects User', 'Medium - Affects Group/Department',
      'High - Affects Buildings/Departments', 'Critical - Affects Organization',
    ],
  },
  {
    key: 'urgency',
    label: 'Urgency',
    control: 'select',
    fieldTypes: ['urgency'],
    fieldIds: ['370'],
    labels: ['Urgency'],
    patterns: [/^urgency$/i],
    options: [
      'Low - Can still do work', 'Medium - Can do work but with workaround',
      'High - Impacting work', 'Critical - Teaching, learning, critical work cannot proceed.',
    ],
  },
  {
    key: 'service',
    label: 'Service',
    control: 'lookup',
    fieldTypes: ['service'],
    fieldIds: ['789'],
    labels: ['Service'],
    patterns: [/^service$/i, /serviceid/i],
    options: [],
  },
  {
    key: 'serviceOffering',
    label: 'Service Offering',
    control: 'lookup',
    fieldTypes: ['service_offering'],
    fieldIds: ['1932'],
    labels: ['Service Offering'],
    patterns: [/service\s*offering/i],
    options: [],
  },
];

/** The five fields the extension writes, in the order it writes them. */
export const FILL_SET: string[] = ['ubitName', 'briefSummary', 'description', 'source', 'service'];

// ponytail: linear find over ~23 entries — a Map index isn't worth it at this size.
export function byKey(key: string): FieldDef | undefined {
  return DICTIONARY.find((d) => d.key === key);
}
