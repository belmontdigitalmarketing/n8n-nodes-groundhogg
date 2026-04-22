import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import type { IDataObject } from 'n8n-workflow';
import { createHash } from 'crypto';

// ============================================================
// Constants
// ============================================================

const OPTIN_STATUS_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Unconfirmed', value: 1 },
	{ name: 'Confirmed', value: 2 },
	{ name: 'Unsubscribed', value: 3 },
	{ name: 'Weekly', value: 4 },
	{ name: 'Monthly', value: 5 },
	{ name: 'Hard Bounce', value: 6 },
	{ name: 'Spam', value: 7 },
	{ name: 'Complained', value: 8 },
	{ name: 'Blocked', value: 9 },
];

const ACTIVITY_TYPE_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Email Opened', value: 'email_opened' },
	{ name: 'Email Link Click', value: 'email_link_click' },
	{ name: 'Form Impression', value: 'form_impression' },
	{ name: 'Form Submission', value: 'form_submission' },
	{ name: 'Unsubscribed', value: 'unsubscribed' },
	{ name: 'Page View', value: 'page_view' },
	{ name: 'WP Login', value: 'wp_login' },
	{ name: 'WP Logout', value: 'wp_logout' },
	{ name: 'Bounce', value: 'bounce' },
	{ name: 'Soft Bounce', value: 'soft_bounce' },
	{ name: 'Complaint', value: 'complaint' },
];

const KNOWN_META_LABELS: Record<string, string> = {
	primary_phone: 'Primary Phone',
	mobile_phone: 'Mobile Phone',
	primary_phone_extension: 'Primary Phone Extension',
	street_address_1: 'Street Address 1',
	street_address_2: 'Street Address 2',
	city: 'City',
	region: 'State/Region',
	postal_zip: 'Postal/ZIP Code',
	country: 'Country',
	company_name: 'Company Name',
	job_title: 'Job Title',
	lead_source: 'Lead Source',
	birthday: 'Birthday',
	notes: 'Notes',
	ip_address: 'IP Address',
	time_zone: 'Time Zone',
	profile_picture: 'Profile Picture',
};
const KNOWN_META_KEYS = Object.keys(KNOWN_META_LABELS);

// ============================================================
// Shared Helpers
// ============================================================

async function getGroundhoggCredentials(
	context: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<{ baseUrl: string; publicKey: string; token: string }> {
	const credentials = await context.getCredentials('groundhoggApi');
	let siteUrl = (credentials.siteUrl as string).trim();
	// Strip trailing slash
	if (siteUrl.endsWith('/')) {
		siteUrl = siteUrl.slice(0, -1);
	}
	const publicKey = credentials.publicKey as string;
	const secretKey = credentials.secretKey as string;
	const token = createHash('md5').update(secretKey + publicKey).digest('hex');
	return { baseUrl: siteUrl, publicKey, token };
}

async function groundhoggApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	baseUrl: string,
	endpoint: string,
	publicKey: string,
	token: string,
	body?: Record<string, any> | any[],
	queryParams?: Record<string, string>,
): Promise<any> {
	const requestOptions: any = {
		method,
		uri: `${baseUrl}/wp-json/gh/v4${endpoint}`,
		headers: {
			'Gh-Public-Key': publicKey,
			'Gh-Token': token,
			'Content-Type': 'application/json',
		},
		json: true,
		qs: queryParams || {},
	};

	if (body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
		requestOptions.body = body;
	}

	return await this.helpers.request(requestOptions);
}

function applyCustomMetaFields(
	context: IExecuteFunctions,
	meta: Record<string, any>,
	paramName: string,
	itemIndex: number,
) {
	const collection = context.getNodeParameter(paramName, itemIndex, {}) as IDataObject;
	const entries = (collection.field as IDataObject[] | undefined) ?? [];
	for (const entry of entries) {
		const key = (entry.key as string | undefined)?.trim();
		if (!key) continue;
		const value = entry.value;
		if (value !== undefined && value !== null && value !== '') {
			meta[key] = value;
		}
	}
}

function normalizeBirthday(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const str = String(value).trim();
	const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
	const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (slashMatch) {
		const [, m, d, y] = slashMatch;
		return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
	}
	const parsed = new Date(str);
	if (!isNaN(parsed.getTime())) {
		const y = parsed.getUTCFullYear();
		const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
		const d = String(parsed.getUTCDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	return str;
}

function parseTagInput(input: string | string[] | undefined | null): (number | string)[] {
	if (input === undefined || input === null) return [];
	const raw: string[] = Array.isArray(input)
		? input.map((t) => String(t))
		: typeof input === 'string' && input.trim()
			? input.split(',')
			: [];
	return raw
		.map((t) => {
			const trimmed = t.trim();
			const num = parseInt(trimmed, 10);
			return isNaN(num) ? trimmed : num;
		})
		.filter((t) => t !== '' && t !== 0);
}

// ============================================================
// Node Definition
// ============================================================

export class Groundhogg implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Groundhogg',
		name: 'groundhogg',
		icon: 'file:groundhogg.svg',
		group: ['apps'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with the Groundhogg CRM API',
		defaults: { name: 'Groundhogg' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'groundhoggApi', required: true }],
		properties: [
			// ============================================================
			// Resource
			// ============================================================
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Activity', value: 'activity' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Contact Tag', value: 'contactTag' },
					{ name: 'Note', value: 'note' },
					{ name: 'Tag', value: 'tag' },
					{ name: 'Task', value: 'task' },
				],
				default: 'contact',
			},

			// ============================================================
			// Operations
			// ============================================================

			// --- Contact Operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a contact' },
					{ name: 'Delete', value: 'delete', action: 'Delete a contact' },
					{ name: 'Get', value: 'get', action: 'Get a contact' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many contacts' },
					{ name: 'Update', value: 'update', action: 'Update a contact' },
				],
				default: 'create',
			},

			// --- Contact Tag Operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contactTag'] } },
				options: [
					{ name: 'Apply Tags', value: 'apply', action: 'Apply tags to a contact' },
					{ name: 'Get Tags', value: 'get', action: 'Get tags on a contact' },
					{ name: 'Remove Tags', value: 'remove', action: 'Remove tags from a contact' },
				],
				default: 'apply',
			},

			// --- Tag Operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['tag'] } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a tag' },
					{ name: 'Delete', value: 'delete', action: 'Delete a tag' },
					{ name: 'Get', value: 'get', action: 'Get a tag' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many tags' },
					{ name: 'Update', value: 'update', action: 'Update a tag' },
				],
				default: 'create',
			},

			// --- Note Operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['note'] } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a note' },
					{ name: 'Delete', value: 'delete', action: 'Delete a note' },
					{ name: 'Get', value: 'get', action: 'Get a note' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many notes' },
					{ name: 'Update', value: 'update', action: 'Update a note' },
				],
				default: 'create',
			},

			// --- Task Operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['task'] } },
				options: [
					{ name: 'Complete', value: 'complete', action: 'Mark a task as complete' },
					{ name: 'Create', value: 'create', action: 'Create a task' },
					{ name: 'Delete', value: 'delete', action: 'Delete a task' },
					{ name: 'Get', value: 'get', action: 'Get a task' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many tasks' },
					{ name: 'Incomplete', value: 'incomplete', action: 'Mark a task as incomplete' },
					{ name: 'Update', value: 'update', action: 'Update a task' },
				],
				default: 'create',
			},

			// --- Activity Operations ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['activity'] } },
				options: [
					{ name: 'Get Many', value: 'getAll', action: 'Get many activity records' },
				],
				default: 'getAll',
			},

			// ============================================================
			// Contact Fields
			// ============================================================

			// --- Contact: Create ---
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
				description: 'The email address of the contact. If the email already exists, the contact will be updated (upsert).',
			},
			{
				displayName: 'First Name',
				name: 'first_name',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
			},
			{
				displayName: 'Last Name',
				name: 'last_name',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
			},
			{
				displayName: 'Phone',
				name: 'primary_phone',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
				description: 'Stored as the primary_phone meta field on the contact',
			},
			{
				displayName: 'Owner Name or ID',
				name: 'owner_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getOwners' },
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
				description:
					'The WordPress user assigned as owner of this contact. List is loaded from your site. Use an expression to pass a user ID that is not in the list.',
			},
			{
				displayName: 'Additional Fields',
				name: 'contactAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
				options: [
					{
						displayName: 'Optin Status',
						name: 'optin_status',
						type: 'options',
						options: OPTIN_STATUS_OPTIONS,
						default: 2,
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tag IDs or tag names to apply',
					},
				],
			},
			{
				displayName: 'Meta Fields',
				name: 'contactMetaFields',
				type: 'collection',
				placeholder: 'Add Meta Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
				options: [
					{ displayName: 'Mobile Phone', name: 'mobile_phone', type: 'string', default: '' },
					{ displayName: 'Street Address 1', name: 'street_address_1', type: 'string', default: '' },
					{ displayName: 'Street Address 2', name: 'street_address_2', type: 'string', default: '' },
					{ displayName: 'City', name: 'city', type: 'string', default: '' },
					{ displayName: 'State/Region', name: 'region', type: 'string', default: '' },
					{ displayName: 'Postal/ZIP Code', name: 'postal_zip', type: 'string', default: '' },
					{ displayName: 'Country', name: 'country', type: 'string', default: '' },
					{ displayName: 'Company Name', name: 'company_name', type: 'string', default: '' },
					{ displayName: 'Job Title', name: 'job_title', type: 'string', default: '' },
					{ displayName: 'Lead Source', name: 'lead_source', type: 'string', default: '' },
					{
						displayName: 'Birthday',
						name: 'birthday',
						type: 'string',
						default: '',
						placeholder: 'YYYY-MM-DD',
						description: 'Stored by Groundhogg as YYYY-MM-DD. Also accepts MM/DD/YYYY or ISO — the node normalizes before sending.',
					},
					{
						displayName: 'Notes',
						name: 'notes',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
					},
				],
			},
			{
				displayName: 'Custom Fields',
				name: 'contactCustomMeta',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				default: {},
				placeholder: 'Add Custom Field',
				description:
					'Set Groundhogg custom field values. Field list is pulled from your Groundhogg custom field configuration (Groundhogg → Settings → Custom Fields).',
				displayOptions: { show: { resource: ['contact'], operation: ['create'] } },
				options: [
					{
						name: 'field',
						displayName: 'Field',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'key',
								type: 'options',
								typeOptions: { loadOptionsMethod: 'getCustomFieldKeys' },
								default: '',
								description:
									'The Groundhogg custom field to set. Choose from the list or specify an ID using an expression.',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},

			// --- Contact: Get ---
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['get', 'delete'] } },
				description: 'The ID of the contact',
			},

			// --- Contact: Get Many ---
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
				description: 'Number of results to skip (for pagination)',
			},
			{
				displayName: 'Filters',
				name: 'contactFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Search',
						name: 'search',
						type: 'string',
						default: '',
						description: 'Free text search across contact fields',
					},
					{
						displayName: 'Email',
						name: 'email',
						type: 'string',
						default: '',
						description: 'Filter by exact email address',
					},
					{
						displayName: 'First Name',
						name: 'first_name',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Last Name',
						name: 'last_name',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Optin Status',
						name: 'optin_status',
						type: 'options',
						options: OPTIN_STATUS_OPTIONS,
						default: 2,
					},
					{
						displayName: 'Tags Include',
						name: 'tags_include',
						type: 'string',
						default: '',
						description: 'Comma-separated tag IDs — only return contacts that have ALL these tags',
					},
					{
						displayName: 'Tags Exclude',
						name: 'tags_exclude',
						type: 'string',
						default: '',
						description: 'Comma-separated tag IDs — exclude contacts that have ANY of these tags',
					},
					{
						displayName: 'Owner ID',
						name: 'owner_id',
						type: 'number',
						default: 0,
						description: 'Filter by owner WordPress user ID',
					},
					{
						displayName: 'Meta Filters',
						name: 'meta_filters',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true, sortable: true },
						default: {},
						placeholder: 'Add Meta Filter',
						description:
							'Filter contacts by meta / custom field values. Multiple filters are ANDed together. Works on built-in meta (company_name, primary_phone, etc.) and on Groundhogg custom fields (use the field internal name).',
						options: [
							{
								name: 'filter',
								displayName: 'Filter',
								values: [
									{
										displayName: 'Meta Key',
										name: 'key',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getAllMetaKeys' },
										default: '',
										description:
											'The meta field to filter on. Includes both built-in contact meta (primary_phone, company_name, birthday, etc.) and Groundhogg custom fields. Use an expression to pass a key that is not in this list.',
									},
									{
										displayName: 'Operator',
										name: 'compare',
										type: 'options',
										default: 'EQ',
										options: [
											{ name: 'Equals', value: 'EQ' },
											{ name: 'Not Equal', value: 'NEQ' },
											{ name: 'Contains', value: 'LIKE' },
											{ name: 'Does Not Contain', value: 'NOT_LIKE' },
											{ name: 'In (Comma-Separated)', value: 'IN' },
											{ name: 'Not In (Comma-Separated)', value: 'NOT_IN' },
											{ name: 'Exists (Any Value)', value: 'EXISTS' },
											{ name: 'Does Not Exist', value: 'NOT_EXISTS' },
										],
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
										description:
											'Value to match. For Contains / Does Not Contain, the node wraps the value with % wildcards automatically — you can still include your own %. For In / Not In, pass a comma-separated list. Ignored for Exists / Does Not Exist.',
										displayOptions: {
											hide: { compare: ['EXISTS', 'NOT_EXISTS'] },
										},
									},
								],
							},
						],
					},
				],
			},

			// --- Contact: Update ---
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
				description: 'The ID of the contact to update',
			},
			{
				displayName: 'Update Fields',
				name: 'contactUpdateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
				options: [
					{ displayName: 'Email', name: 'email', type: 'string', default: '' },
					{ displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
					{ displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
					{
						displayName: 'Optin Status',
						name: 'optin_status',
						type: 'options',
						options: OPTIN_STATUS_OPTIONS,
						default: 2,
					},
					{
						displayName: 'Owner ID',
						name: 'owner_id',
						type: 'number',
						default: 0,
					},
				],
			},
			{
				displayName: 'Update Meta Fields',
				name: 'contactUpdateMetaFields',
				type: 'collection',
				placeholder: 'Add Meta Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
				options: [
					{ displayName: 'Primary Phone', name: 'primary_phone', type: 'string', default: '' },
					{ displayName: 'Mobile Phone', name: 'mobile_phone', type: 'string', default: '' },
					{ displayName: 'Street Address 1', name: 'street_address_1', type: 'string', default: '' },
					{ displayName: 'Street Address 2', name: 'street_address_2', type: 'string', default: '' },
					{ displayName: 'City', name: 'city', type: 'string', default: '' },
					{ displayName: 'State/Region', name: 'region', type: 'string', default: '' },
					{ displayName: 'Postal/ZIP Code', name: 'postal_zip', type: 'string', default: '' },
					{ displayName: 'Country', name: 'country', type: 'string', default: '' },
					{ displayName: 'Company Name', name: 'company_name', type: 'string', default: '' },
					{ displayName: 'Job Title', name: 'job_title', type: 'string', default: '' },
					{ displayName: 'Lead Source', name: 'lead_source', type: 'string', default: '' },
					{
						displayName: 'Birthday',
						name: 'birthday',
						type: 'string',
						default: '',
						placeholder: 'YYYY-MM-DD',
						description: 'Stored by Groundhogg as YYYY-MM-DD. Also accepts MM/DD/YYYY or ISO — the node normalizes before sending.',
					},
					{
						displayName: 'Notes',
						name: 'notes',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
					},
				],
			},
			{
				displayName: 'Add Tags',
				name: 'contactAddTags',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
				description: 'Comma-separated list of tag IDs or names to apply',
			},
			{
				displayName: 'Remove Tags',
				name: 'contactRemoveTags',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTags' },
				default: [],
				displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
				description:
					'Tags to remove from the contact. Only existing tags can be removed, so this is a dropdown. Use an expression to pass IDs dynamically.',
			},
			{
				displayName: 'Custom Fields',
				name: 'contactUpdateCustomMeta',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				default: {},
				placeholder: 'Add Custom Field',
				description:
					'Set Groundhogg custom field values. Field list is pulled from your Groundhogg custom field configuration (Groundhogg → Settings → Custom Fields).',
				displayOptions: { show: { resource: ['contact'], operation: ['update'] } },
				options: [
					{
						name: 'field',
						displayName: 'Field',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'key',
								type: 'options',
								typeOptions: { loadOptionsMethod: 'getCustomFieldKeys' },
								default: '',
								description:
									'The Groundhogg custom field to set. Choose from the list or specify an ID using an expression.',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},

			// ============================================================
			// Contact Tag Fields
			// ============================================================

			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['contactTag'] } },
				description: 'The ID of the contact',
			},
			{
				displayName: 'Tags',
				name: 'tagIds',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['contactTag'], operation: ['apply'] } },
				description: 'Comma-separated list of tag IDs or tag names to apply. Non-existing tag names will be auto-created.',
			},
			{
				displayName: 'Tag Names or IDs',
				name: 'tagIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTags' },
				default: [],
				required: true,
				displayOptions: { show: { resource: ['contactTag'], operation: ['remove'] } },
				description:
					'Tags to remove from the contact. Only existing tags can be removed, so this is a dropdown. Use an expression to pass IDs dynamically.',
			},

			// ============================================================
			// Tag Fields
			// ============================================================

			// --- Tag: Create ---
			{
				displayName: 'Tag Name',
				name: 'tagName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['tag'], operation: ['create'] } },
				description: 'The name for the new tag',
			},
			{
				displayName: 'Tag Description',
				name: 'tagDescription',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['tag'], operation: ['create'] } },
			},

			// --- Tag: Get / Delete ---
			{
				displayName: 'Tag ID',
				name: 'tagId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['tag'], operation: ['get', 'delete'] } },
				description: 'The ID of the tag',
			},

			// --- Tag: Get Many ---
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 500 },
				displayOptions: { show: { resource: ['tag'], operation: ['getAll'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'tagFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['tag'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Search',
						name: 'search',
						type: 'string',
						default: '',
						description: 'Free-text search across tag name, slug and description',
					},
					{
						displayName: 'Tag Name',
						name: 'tag_name',
						type: 'string',
						default: '',
						description: 'Filter by exact tag name',
					},
					{
						displayName: 'Tag Slug',
						name: 'tag_slug',
						type: 'string',
						default: '',
						description: 'Filter by exact tag slug',
					},
				],
			},

			// --- Tag: Update ---
			{
				displayName: 'Tag ID',
				name: 'tagId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['tag'], operation: ['update'] } },
			},
			{
				displayName: 'Update Fields',
				name: 'tagUpdateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['tag'], operation: ['update'] } },
				options: [
					{ displayName: 'Tag Name', name: 'tag_name', type: 'string', default: '' },
					{ displayName: 'Tag Description', name: 'tag_description', type: 'string', default: '' },
				],
			},

			// ============================================================
			// Note Fields
			// ============================================================

			// --- Note: Create ---
			{
				displayName: 'Contact ID',
				name: 'objectId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['note'], operation: ['create'] } },
				description: 'The ID of the contact to attach the note to',
			},
			{
				displayName: 'Content',
				name: 'noteContent',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['note'], operation: ['create'] } },
				description: 'The content of the note (HTML supported)',
			},
			{
				displayName: 'Additional Fields',
				name: 'noteAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['note'], operation: ['create'] } },
				options: [
					{ displayName: 'Summary', name: 'summary', type: 'string', default: '' },
					{
						displayName: 'Type',
						name: 'type',
						type: 'string',
						default: 'note',
						description: 'The type of the note (e.g., "note", "call", "email")',
					},
					{
						displayName: 'Context',
						name: 'context',
						type: 'string',
						default: 'user',
						description: 'The context of note creation (e.g., "user", "system")',
					},
				],
			},

			// --- Note: Get / Delete ---
			{
				displayName: 'Note ID',
				name: 'noteId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['note'], operation: ['get', 'delete'] } },
			},

			// --- Note: Get Many ---
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: { show: { resource: ['note'], operation: ['getAll'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'noteFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['note'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Contact ID',
						name: 'object_id',
						type: 'number',
						default: 0,
						description: 'Filter notes by contact ID',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'string',
						default: '',
						description: 'Filter by note type',
					},
				],
			},

			// --- Note: Update ---
			{
				displayName: 'Note ID',
				name: 'noteId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['note'], operation: ['update'] } },
			},
			{
				displayName: 'Update Fields',
				name: 'noteUpdateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['note'], operation: ['update'] } },
				options: [
					{
						displayName: 'Content',
						name: 'content',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
					},
					{ displayName: 'Summary', name: 'summary', type: 'string', default: '' },
					{ displayName: 'Type', name: 'type', type: 'string', default: '' },
				],
			},

			// ============================================================
			// Task Fields
			// ============================================================

			// --- Task: Create ---
			{
				displayName: 'Summary',
				name: 'taskSummary',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['task'], operation: ['create'] } },
				description: 'The task title/summary',
			},
			{
				displayName: 'Contact ID',
				name: 'objectId',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['task'], operation: ['create'] } },
				description: 'The ID of the contact this task is related to',
			},
			{
				displayName: 'Additional Fields',
				name: 'taskAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['task'], operation: ['create'] } },
				options: [
					{
						displayName: 'Content',
						name: 'content',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
						description: 'Task details (HTML supported)',
					},
					{
						displayName: 'Due Date',
						name: 'due_date',
						type: 'dateTime',
						default: '',
						description: 'When the task is due (local time)',
					},
					{
						displayName: 'Assigned User ID',
						name: 'user_id',
						type: 'number',
						default: 0,
						description: 'WordPress user ID of the assigned user',
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'string',
						default: 'task',
					},
				],
			},

			// --- Task: Get / Delete / Complete / Incomplete ---
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['task'], operation: ['get', 'delete', 'complete', 'incomplete'] } },
			},

			// --- Task: Get Many ---
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: { show: { resource: ['task'], operation: ['getAll'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'taskFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['task'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Contact ID',
						name: 'object_id',
						type: 'number',
						default: 0,
						description: 'Filter tasks by contact ID',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'All', value: 'all' },
							{ name: 'Incomplete', value: 'incomplete' },
							{ name: 'Complete', value: 'complete' },
						],
						default: 'all',
					},
					{
						displayName: 'Assigned User ID',
						name: 'user_id',
						type: 'number',
						default: 0,
						description: 'Filter by assigned WordPress user ID',
					},
				],
			},

			// --- Task: Update ---
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['task'], operation: ['update'] } },
			},
			{
				displayName: 'Update Fields',
				name: 'taskUpdateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['task'], operation: ['update'] } },
				options: [
					{ displayName: 'Summary', name: 'summary', type: 'string', default: '' },
					{
						displayName: 'Content',
						name: 'content',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
					},
					{
						displayName: 'Due Date',
						name: 'due_date',
						type: 'dateTime',
						default: '',
					},
					{
						displayName: 'Assigned User ID',
						name: 'user_id',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'string',
						default: '',
					},
				],
			},

			// ============================================================
			// Activity Fields
			// ============================================================

			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: { show: { resource: ['activity'], operation: ['getAll'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'activityFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['activity'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Contact ID',
						name: 'contact_id',
						type: 'number',
						default: 0,
						description: 'Filter activity by contact ID',
					},
					{
						displayName: 'Activity Type',
						name: 'activity_type',
						type: 'options',
						options: ACTIVITY_TYPE_OPTIONS,
						default: '',
					},
				],
			},
		],
	};

	// ============================================================
	// Methods
	// ============================================================

	methods = {
		loadOptions: {
			async getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const { baseUrl, publicKey, token } = await getGroundhoggCredentials(this);
					const response = await groundhoggApiRequest.call(
						this, 'GET', baseUrl, '/tags', publicKey, token,
						undefined, { limit: '500' },
					);
					const items = (response?.items ?? []) as any[];
					return items
						.map((tag: any) => {
							const data = tag.data ?? tag;
							const id = data.tag_id ?? tag.ID ?? tag.id;
							if (id === undefined || id === null) return null;
							const name = data.tag_name || data.tag_slug || `Tag ${id}`;
							return { name, value: String(id) } as INodePropertyOptions;
						})
						.filter((o: INodePropertyOptions | null): o is INodePropertyOptions => o !== null)
						.sort((a, b) => String(a.name).localeCompare(String(b.name)));
				} catch {
					return [];
				}
			},

			async getCustomFieldKeys(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const { baseUrl, publicKey, token } = await getGroundhoggCredentials(this);
					const response = await groundhoggApiRequest.call(
						this, 'GET', baseUrl, '/fields', publicKey, token,
					);
					if (!response?.items) return [];
					return response.items
						.filter((f: any) => !KNOWN_META_KEYS.includes(f.value || f.id))
						.map((f: any) => ({
							name: f.label || f.value || f.id,
							value: f.value || f.id,
						}));
				} catch {
					return [];
				}
			},

			async getOwners(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const { baseUrl, publicKey, token } = await getGroundhoggCredentials(this);
					const requestOptions: any = {
						method: 'GET',
						uri: `${baseUrl}/wp-json/wp/v2/users`,
						headers: {
							'Gh-Public-Key': publicKey,
							'Gh-Token': token,
						},
						qs: { per_page: '100', context: 'edit' },
						json: true,
					};
					const users = await this.helpers.request(requestOptions);
					if (!Array.isArray(users)) return [];
					return users
						.map((u: any) => ({
							name: u.name || u.slug || u.username || `User ${u.id}`,
							value: String(u.id),
						}))
						.sort((a: INodePropertyOptions, b: INodePropertyOptions) =>
							String(a.name).localeCompare(String(b.name)),
						);
				} catch {
					return [];
				}
			},

			async getAllMetaKeys(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const seen = new Set<string>();
				const options: INodePropertyOptions[] = [];

				try {
					const { baseUrl, publicKey, token } = await getGroundhoggCredentials(this);
					const response = await groundhoggApiRequest.call(
						this, 'GET', baseUrl, '/fields', publicKey, token,
					);
					for (const f of (response?.items ?? []) as any[]) {
						const value = (f.value || f.id) as string | undefined;
						if (!value || seen.has(value)) continue;
						const label = f.label || KNOWN_META_LABELS[value] || value;
						options.push({ name: label, value });
						seen.add(value);
					}
				} catch {
					// fall through to built-ins
				}

				// Ensure all built-in meta keys are present even if /fields returned nothing
				for (const [value, name] of Object.entries(KNOWN_META_LABELS)) {
					if (!seen.has(value)) {
						options.push({ name, value });
						seen.add(value);
					}
				}

				options.sort((a, b) => a.name.localeCompare(b.name));
				return options;
			},
		},
	};

	// ============================================================
	// Execute
	// ============================================================

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const { baseUrl, publicKey, token } = await getGroundhoggCredentials(this);
				let responseData: any;

				// ======================
				// Contact
				// ======================
				if (resource === 'contact') {
					if (operation === 'create') {
						const email = this.getNodeParameter('email', i) as string;
						const firstName = this.getNodeParameter('first_name', i, '') as string;
						const lastName = this.getNodeParameter('last_name', i, '') as string;
						const phone = this.getNodeParameter('primary_phone', i, '') as string;
						const ownerId = this.getNodeParameter('owner_id', i, '') as string | number;
						const additional = this.getNodeParameter('contactAdditionalFields', i) as IDataObject;
						const metaFields = this.getNodeParameter('contactMetaFields', i) as IDataObject;

						const data: Record<string, any> = { email };
						const meta: Record<string, any> = {};

						// Top-level core fields
						if (firstName) data.first_name = firstName;
						if (lastName) data.last_name = lastName;
						if (ownerId !== '' && ownerId !== 0 && ownerId !== '0') {
							data.owner_id = typeof ownerId === 'string' ? parseInt(ownerId, 10) || ownerId : ownerId;
						}

						// Additional fields collection (optin_status only — tags handled below)
						if (additional.optin_status !== undefined && additional.optin_status !== '') {
							data.optin_status = additional.optin_status;
						}

						// Top-level phone
						if (phone) meta.primary_phone = phone;

						// Meta fields collection
						for (const [key, value] of Object.entries(metaFields)) {
							if (value !== undefined && value !== null && value !== '') {
								meta[key] = key === 'birthday' ? normalizeBirthday(value) : value;
							}
						}

						// Custom / meta fields selected via dropdown
						applyCustomMetaFields(this, meta, 'contactCustomMeta', i);

						const body: Record<string, any> = { data };
						if (Object.keys(meta).length > 0) body.meta = meta;

						// Tags
						if (additional.tags && (additional.tags as string).trim()) {
							body.tags = parseTagInput(additional.tags as string);
						}

						responseData = await groundhoggApiRequest.call(
							this, 'POST', baseUrl, '/contacts', publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'get') {
						const contactId = this.getNodeParameter('contactId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, `/contacts/${contactId}`, publicKey, token,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'getAll') {
						const limit = this.getNodeParameter('limit', i) as number;
						const offset = this.getNodeParameter('offset', i) as number;
						const filters = this.getNodeParameter('contactFilters', i) as IDataObject;

						const qs: Record<string, string> = {
							limit: limit.toString(),
							offset: offset.toString(),
							found_rows: 'true',
						};

						if (filters.search) qs['search'] = filters.search as string;
						if (filters.email) qs['query[email]'] = filters.email as string;
						if (filters.first_name) qs['query[first_name]'] = filters.first_name as string;
						if (filters.last_name) qs['query[last_name]'] = filters.last_name as string;
						if (filters.optin_status) qs['query[optin_status]'] = filters.optin_status.toString();
						if (filters.owner_id && filters.owner_id !== 0) qs['query[owner_id]'] = filters.owner_id.toString();

						if (filters.tags_include && (filters.tags_include as string).trim()) {
							const tagIds = (filters.tags_include as string).split(',').map((t) => t.trim());
							tagIds.forEach((id, idx) => { qs[`query[tags_include][${idx}]`] = id; });
						}
						if (filters.tags_exclude && (filters.tags_exclude as string).trim()) {
							const tagIds = (filters.tags_exclude as string).split(',').map((t) => t.trim());
							tagIds.forEach((id, idx) => { qs[`query[tags_exclude][${idx}]`] = id; });
						}

						// Meta filters — WP-style meta_query clauses
						const operatorMap: Record<string, string> = {
							EQ: '=',
							NEQ: '!=',
							LIKE: 'LIKE',
							NOT_LIKE: 'NOT LIKE',
							IN: 'IN',
							NOT_IN: 'NOT IN',
							EXISTS: 'EXISTS',
							NOT_EXISTS: 'NOT EXISTS',
						};
						const metaFilters = filters.meta_filters as IDataObject | undefined;
						const metaEntries = (metaFilters?.filter as IDataObject[] | undefined) ?? [];
						metaEntries.forEach((entry, idx) => {
							const key = (entry.key as string | undefined)?.trim();
							if (!key) return;
							const uiCompare = (entry.compare as string | undefined) || 'EQ';
							const sqlCompare = operatorMap[uiCompare] ?? uiCompare;
							const prefix = `query[meta_query][${idx}]`;
							qs[`${prefix}[key]`] = key;
							qs[`${prefix}[compare]`] = sqlCompare;

							if (sqlCompare === 'EXISTS' || sqlCompare === 'NOT EXISTS') return;

							const rawValue = (entry.value as string | undefined) ?? '';
							if (sqlCompare === 'IN' || sqlCompare === 'NOT IN') {
								rawValue
									.split(',')
									.map((v) => v.trim())
									.filter((v) => v.length > 0)
									.forEach((v, vIdx) => { qs[`${prefix}[value][${vIdx}]`] = v; });
							} else if (sqlCompare === 'LIKE' || sqlCompare === 'NOT LIKE') {
								const trimmed = rawValue.trim();
								const pattern = trimmed.includes('%') ? trimmed : `%${trimmed}%`;
								qs[`${prefix}[value]`] = pattern;
							} else {
								qs[`${prefix}[value]`] = rawValue;
							}
						});

						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, '/contacts', publicKey, token, undefined, qs,
						);

						for (const item of (responseData?.items || [])) {
							returnData.push({ json: item });
						}
						continue;

					} else if (operation === 'update') {
						const contactId = this.getNodeParameter('contactId', i) as number;
						const updateFields = this.getNodeParameter('contactUpdateFields', i) as IDataObject;
						const updateMetaFields = this.getNodeParameter('contactUpdateMetaFields', i) as IDataObject;
						const addTags = this.getNodeParameter('contactAddTags', i) as string;
						const removeTags = this.getNodeParameter('contactRemoveTags', i, []) as string | string[];

						const data: Record<string, any> = {};
						const meta: Record<string, any> = {};

						for (const field of ['email', 'first_name', 'last_name', 'optin_status', 'owner_id']) {
							if (updateFields[field] !== undefined && updateFields[field] !== '') {
								data[field] = updateFields[field];
							}
						}

						for (const [key, value] of Object.entries(updateMetaFields)) {
							if (value !== undefined && value !== null && value !== '') {
								meta[key] = key === 'birthday' ? normalizeBirthday(value) : value;
							}
						}

						applyCustomMetaFields(this, meta, 'contactUpdateCustomMeta', i);

						const body: Record<string, any> = {};
						if (Object.keys(data).length > 0) body.data = data;
						if (Object.keys(meta).length > 0) body.meta = meta;
						if (addTags && addTags.trim()) body.add_tags = parseTagInput(addTags);
						const removeTagList = parseTagInput(removeTags);
						if (removeTagList.length > 0) body.remove_tags = removeTagList;

						responseData = await groundhoggApiRequest.call(
							this, 'PUT', baseUrl, `/contacts/${contactId}`, publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'delete') {
						const contactId = this.getNodeParameter('contactId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'DELETE', baseUrl, `/contacts/${contactId}`, publicKey, token,
						);
					}
				}

				// ======================
				// Contact Tag
				// ======================
				if (resource === 'contactTag') {
					const contactId = this.getNodeParameter('contactId', i) as number;

					if (operation === 'apply') {
						const tagInput = this.getNodeParameter('tagIds', i) as string;
						const tags = parseTagInput(tagInput);
						responseData = await groundhoggApiRequest.call(
							this, 'POST', baseUrl, `/contacts/${contactId}/tags`, publicKey, token, tags as any,
						);

					} else if (operation === 'remove') {
						const tagInput = this.getNodeParameter('tagIds', i) as string | string[];
						const tags = parseTagInput(tagInput);
						responseData = await groundhoggApiRequest.call(
							this, 'DELETE', baseUrl, `/contacts/${contactId}/tags`, publicKey, token, tags as any,
						);

					} else if (operation === 'get') {
						// Fetch the full contact so each tag comes back with name/slug/etc.,
						// not just the ID list that /contacts/{id}/tags returns.
						const contactResponse = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, `/contacts/${contactId}`, publicKey, token,
						);
						const contact = contactResponse?.item ?? contactResponse;
						const rawTags = (contact?.tags ?? []) as any[];
						const tags = rawTags.map((tag: any) => {
							const data = tag.data ?? tag;
							return {
								id: data.tag_id ?? tag.ID ?? tag.id,
								name: data.tag_name ?? null,
								slug: data.tag_slug ?? null,
								description: data.tag_description ?? null,
							};
						});
						responseData = { tags, status: 'success' };
					}
				}

				// ======================
				// Tag
				// ======================
				if (resource === 'tag') {
					if (operation === 'create') {
						const tagName = this.getNodeParameter('tagName', i) as string;
						const tagDescription = this.getNodeParameter('tagDescription', i) as string;
						const body: Record<string, any> = { tag_name: tagName };
						if (tagDescription) body.tag_description = tagDescription;

						responseData = await groundhoggApiRequest.call(
							this, 'POST', baseUrl, '/tags', publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'get') {
						const tagId = this.getNodeParameter('tagId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, `/tags/${tagId}`, publicKey, token,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'getAll') {
						const limit = this.getNodeParameter('limit', i) as number;
						const tagFilters = this.getNodeParameter('tagFilters', i, {}) as IDataObject;
						const qs: Record<string, string> = { limit: limit.toString() };

						if (tagFilters.search) qs['search'] = tagFilters.search as string;
						if (tagFilters.tag_name) qs['query[tag_name]'] = tagFilters.tag_name as string;
						if (tagFilters.tag_slug) qs['query[tag_slug]'] = tagFilters.tag_slug as string;

						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, '/tags', publicKey, token, undefined, qs,
						);
						for (const item of (responseData?.items || [])) {
							returnData.push({ json: item });
						}
						continue;

					} else if (operation === 'update') {
						const tagId = this.getNodeParameter('tagId', i) as number;
						const updateFields = this.getNodeParameter('tagUpdateFields', i) as IDataObject;
						const body: Record<string, any> = { data: {} };
						for (const [key, value] of Object.entries(updateFields)) {
							if (value !== undefined && value !== '') {
								body.data[key] = value;
							}
						}
						responseData = await groundhoggApiRequest.call(
							this, 'PUT', baseUrl, `/tags/${tagId}`, publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'delete') {
						const tagId = this.getNodeParameter('tagId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'DELETE', baseUrl, `/tags/${tagId}`, publicKey, token,
						);
					}
				}

				// ======================
				// Note
				// ======================
				if (resource === 'note') {
					if (operation === 'create') {
						const objectId = this.getNodeParameter('objectId', i) as number;
						const content = this.getNodeParameter('noteContent', i) as string;
						const additional = this.getNodeParameter('noteAdditionalFields', i) as IDataObject;

						const body: Record<string, any> = {
							object_id: objectId,
							object_type: 'contact',
							content,
						};

						for (const field of ['summary', 'type', 'context']) {
							if (additional[field] !== undefined && additional[field] !== '') {
								body[field] = additional[field];
							}
						}

						responseData = await groundhoggApiRequest.call(
							this, 'POST', baseUrl, '/notes', publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'get') {
						const noteId = this.getNodeParameter('noteId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, `/notes/${noteId}`, publicKey, token,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'getAll') {
						const limit = this.getNodeParameter('limit', i) as number;
						const filters = this.getNodeParameter('noteFilters', i) as IDataObject;
						const qs: Record<string, string> = { limit: limit.toString() };

						if (filters.object_id && filters.object_id !== 0) {
							qs['query[object_id]'] = filters.object_id.toString();
							qs['query[object_type]'] = 'contact';
						}
						if (filters.type) qs['query[type]'] = filters.type as string;

						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, '/notes', publicKey, token, undefined, qs,
						);
						for (const item of (responseData?.items || [])) {
							returnData.push({ json: item });
						}
						continue;

					} else if (operation === 'update') {
						const noteId = this.getNodeParameter('noteId', i) as number;
						const updateFields = this.getNodeParameter('noteUpdateFields', i) as IDataObject;
						const body: Record<string, any> = { data: {} };
						for (const [key, value] of Object.entries(updateFields)) {
							if (value !== undefined && value !== '') {
								body.data[key] = value;
							}
						}
						responseData = await groundhoggApiRequest.call(
							this, 'PUT', baseUrl, `/notes/${noteId}`, publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'delete') {
						const noteId = this.getNodeParameter('noteId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'DELETE', baseUrl, `/notes/${noteId}`, publicKey, token,
						);
					}
				}

				// ======================
				// Task
				// ======================
				if (resource === 'task') {
					if (operation === 'create') {
						const summary = this.getNodeParameter('taskSummary', i) as string;
						const objectId = this.getNodeParameter('objectId', i) as number;
						const additional = this.getNodeParameter('taskAdditionalFields', i) as IDataObject;

						const body: Record<string, any> = {
							summary,
							object_type: 'contact',
						};
						if (objectId) body.object_id = objectId;

						for (const field of ['content', 'due_date', 'user_id', 'type']) {
							if (additional[field] !== undefined && additional[field] !== '' && additional[field] !== 0) {
								body[field] = additional[field];
							}
						}

						responseData = await groundhoggApiRequest.call(
							this, 'POST', baseUrl, '/tasks', publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'get') {
						const taskId = this.getNodeParameter('taskId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, `/tasks/${taskId}`, publicKey, token,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'getAll') {
						const limit = this.getNodeParameter('limit', i) as number;
						const filters = this.getNodeParameter('taskFilters', i) as IDataObject;
						const qs: Record<string, string> = { limit: limit.toString() };

						if (filters.object_id && filters.object_id !== 0) {
							qs['query[object_id]'] = filters.object_id.toString();
							qs['query[object_type]'] = 'contact';
						}
						if (filters.user_id && filters.user_id !== 0) {
							qs['query[user_id]'] = filters.user_id.toString();
						}
						if (filters.status === 'incomplete') qs['query[complete]'] = '0';
						if (filters.status === 'complete') qs['query[complete]'] = '1';

						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, '/tasks', publicKey, token, undefined, qs,
						);
						for (const item of (responseData?.items || [])) {
							returnData.push({ json: item });
						}
						continue;

					} else if (operation === 'update') {
						const taskId = this.getNodeParameter('taskId', i) as number;
						const updateFields = this.getNodeParameter('taskUpdateFields', i) as IDataObject;
						const body: Record<string, any> = { data: {} };
						for (const [key, value] of Object.entries(updateFields)) {
							if (value !== undefined && value !== '' && value !== 0) {
								body.data[key] = value;
							}
						}
						responseData = await groundhoggApiRequest.call(
							this, 'PUT', baseUrl, `/tasks/${taskId}`, publicKey, token, body,
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'delete') {
						const taskId = this.getNodeParameter('taskId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'DELETE', baseUrl, `/tasks/${taskId}`, publicKey, token,
						);

					} else if (operation === 'complete') {
						const taskId = this.getNodeParameter('taskId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'PUT', baseUrl, `/tasks/${taskId}/complete`, publicKey, token, {},
						);
						if (responseData?.item) responseData = responseData.item;

					} else if (operation === 'incomplete') {
						const taskId = this.getNodeParameter('taskId', i) as number;
						responseData = await groundhoggApiRequest.call(
							this, 'PUT', baseUrl, `/tasks/${taskId}/incomplete`, publicKey, token, {},
						);
						if (responseData?.item) responseData = responseData.item;
					}
				}

				// ======================
				// Activity
				// ======================
				if (resource === 'activity') {
					if (operation === 'getAll') {
						const limit = this.getNodeParameter('limit', i) as number;
						const filters = this.getNodeParameter('activityFilters', i) as IDataObject;
						const qs: Record<string, string> = { limit: limit.toString() };

						// contact_id also sent top-level because activity's permission callback reads it there
						if (filters.contact_id && filters.contact_id !== 0) {
							qs['contact_id'] = filters.contact_id.toString();
							qs['query[contact_id]'] = filters.contact_id.toString();
						}
						if (filters.activity_type) qs['query[activity_type]'] = filters.activity_type as string;

						responseData = await groundhoggApiRequest.call(
							this, 'GET', baseUrl, '/activity', publicKey, token, undefined, qs,
						);
						for (const item of (responseData?.items || [])) {
							returnData.push({ json: item });
						}
						continue;
					}
				}

				// Push single-item responses
				if (responseData !== undefined) {
					returnData.push({ json: responseData });
				}

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
					});
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
