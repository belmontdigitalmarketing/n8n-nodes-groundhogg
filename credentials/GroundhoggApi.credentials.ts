import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class GroundhoggApi implements ICredentialType {
	name = 'groundhoggApi';
	displayName = 'Groundhogg API';
	documentationUrl = 'https://help.groundhogg.io/category/514-rest-api-v4';
	properties: INodeProperties[] = [
		{
			displayName: 'Site URL',
			name: 'siteUrl',
			type: 'string',
			default: '',
			placeholder: 'https://example.com',
			description: 'The URL of your WordPress site with Groundhogg installed (e.g., "https://example.com")',
			required: true,
		},
		{
			displayName: 'Public Key',
			name: 'publicKey',
			type: 'string',
			default: '',
			description: 'Your Groundhogg public API key from Groundhogg > Settings > API Keys',
			required: true,
		},
		{
			displayName: 'Secret Key',
			name: 'secretKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'Your Groundhogg secret API key from Groundhogg > Settings > API Keys',
			required: true,
		},
	];
}
