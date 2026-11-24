import type { NormalizedWorkflow } from '../../workflow';
import { bottomTaintState, createTaintState, isTainted, type TaintLabel, type TaintState } from './taint-lattice';

const INBOUND_MESSAGE_TRIGGERS: readonly string[] = [
  'n8n-nodes-base.emailReadImap',
  'n8n-nodes-base.telegramTrigger',
  '@n8n/n8n-nodes-langchain.chatTrigger',
  '@n8n/n8n-nodes-langchain.manualChatTrigger',
  '@n8n/n8n-nodes-langchain.mcpTrigger',
  'n8n-nodes-base.gmailTrigger',
  'n8n-nodes-base.slackTrigger',
  'n8n-nodes-base.whatsAppTrigger',
  'n8n-nodes-base.discordTrigger',
  'n8n-nodes-discord-trigger.discordTrigger',
  'n8n-nodes-base.githubTrigger',
  'n8n-nodes-base.gitlabTrigger',
  'n8n-nodes-base.bitbucketTrigger',
  'n8n-nodes-base.stripeTrigger',
  'n8n-nodes-base.shopifyTrigger',
  'n8n-nodes-base.typeformTrigger',
  'n8n-nodes-base.jotFormTrigger',
  'n8n-nodes-base.airtableTrigger',
  'n8n-nodes-base.notionTrigger',
  'n8n-nodes-base.hubspotTrigger',
  'n8n-nodes-base.jiraTrigger',
  'n8n-nodes-base.linearTrigger',
  'n8n-nodes-base.zendeskTrigger',
  'n8n-nodes-base.intercomTrigger',
  'n8n-nodes-base.rssFeedReadTrigger',
  'n8n-nodes-base.microsoftOutlookTrigger',
  'n8n-nodes-base.microsoftTeamsTrigger',
  'n8n-nodes-base.mcpTrigger',
  'n8n-nodes-base.mqttTrigger',
  'n8n-nodes-base.kafkaTrigger',
  'n8n-nodes-base.amqpTrigger',
  'n8n-nodes-base.rabbitmqTrigger',
  'n8n-nodes-base.postgresTrigger',
  'n8n-nodes-base.supabaseTrigger',
  'n8n-nodes-base.twilioTrigger',
  'n8n-nodes-base.calendlyTrigger',
  'n8n-nodes-base.calTrigger',
  'n8n-nodes-base.wooCommerceTrigger',
  'n8n-nodes-base.trelloTrigger',
  'n8n-nodes-base.asanaTrigger',
  'n8n-nodes-base.clickUpTrigger',
  'n8n-nodes-base.salesforceTrigger',
  'n8n-nodes-base.pipedriveTrigger',
  'n8n-nodes-base.mailchimpTrigger',
  'n8n-nodes-base.mattermostTrigger',
  'n8n-nodes-base.emailTrigger',
  'n8n-nodes-base.imapTrigger',
  'n8n-nodes-base.webhookTrigger',
  'n8n-nodes-base.webflowTrigger',
  'n8n-nodes-base.stravaTrigger',
  'n8n-nodes-base.gumroadTrigger',
  'n8n-nodes-base.lemlistTrigger',
  'n8n-nodes-base.onfleetTrigger',
  'n8n-nodes-base.facebookLeadAdsTrigger',
  'n8n-nodes-base.facebookTrigger',
  'n8n-nodes-base.mauticTrigger',
  'n8n-nodes-base.theHiveProjectTrigger',
  'n8n-nodes-base.eventbriteTrigger',
  'n8n-nodes-base.convertKitTrigger',
  'n8n-nodes-base.netlifyTrigger',
  'n8n-nodes-base.sendInBlueTrigger',
  'n8n-nodes-base.figmaTrigger',
  'n8n-nodes-base.awsSnsTrigger',
  'n8n-nodes-base.taigaTrigger',
];

const EXTERNAL_FILE_SOURCES: readonly string[] = [
  'n8n-nodes-base.extractFromFile',
  'n8n-nodes-base.readWriteFile',
  'n8n-nodes-base.readBinaryFile',
  'n8n-nodes-base.googleDriveTrigger',
  'n8n-nodes-base.googleSheetsTrigger',
  'n8n-nodes-base.googleCalendarTrigger',
  'n8n-nodes-base.awsS3Trigger',
  'n8n-nodes-base.s3Trigger',
  'n8n-nodes-base.dropboxTrigger',
  'n8n-nodes-base.boxTrigger',
  'n8n-nodes-base.oneDriveTrigger',
  'n8n-nodes-base.microsoftOneDriveTrigger',
  'n8n-nodes-base.localFileTrigger',
];

const TAINT_SOURCE_RULES: ReadonlyMap<string, readonly TaintLabel[]> = new Map([
  ['n8n-nodes-base.webhook', ['WEBHOOK_BODY', 'WEBHOOK_QUERY', 'WEBHOOK_HEADER']],
  ['n8n-nodes-base.formTrigger', ['WEBHOOK_BODY']],
  ['n8n-nodes-base.httpRequest', ['EXTERNAL_HTTP_RESPONSE']],
  ...INBOUND_MESSAGE_TRIGGERS.map((type): readonly [string, readonly TaintLabel[]] => [type, ['INBOUND_MESSAGE']]),
  ...EXTERNAL_FILE_SOURCES.map((type): readonly [string, readonly TaintLabel[]] => [type, ['EXTERNAL_FILE']]),
]);

const NON_DATA_TRIGGER_TYPES = new Set([
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.n8nTrigger',
  'n8n-nodes-base.errorTrigger',
  'n8n-nodes-base.activationTrigger',
  'n8n-nodes-base.workflowTrigger',
  'n8n-nodes-base.executeWorkflowTrigger',
  'n8n-nodes-base.evaluationTrigger',
  '@n8n/n8n-nodes-langchain.evaluationTrigger',
]);

const AI_OUTPUT_NODE_TYPES = new Set([
  '@n8n/n8n-nodes-langchain.agent', '@n8n/n8n-nodes-langchain.chainLlm',
]);

export function seedTaintStates(workflow: NormalizedWorkflow): TaintState[] {
  return workflow.nodes.map((node) => {
    const labels = TAINT_SOURCE_RULES.get(node.type);
    return labels === undefined ? bottomTaintState : createTaintState(labels, []);
  });
}

export function isTaintSourceType(nodeType: string): boolean {
  return TAINT_SOURCE_RULES.has(nodeType);
}

/** Returns a frozen snapshot from the existing source registry; absent types remain unknown. */
export function taintSourceLabelsFor(nodeType: string): readonly TaintLabel[] | undefined {
  const labels = TAINT_SOURCE_RULES.get(nodeType);
  return labels === undefined ? undefined : Object.freeze([...labels]);
}

export function isUnsupportedTaintTriggerType(nodeType: string): boolean {
  return nodeType.toLowerCase().endsWith('trigger')
    && !TAINT_SOURCE_RULES.has(nodeType)
    && !NON_DATA_TRIGGER_TYPES.has(nodeType);
}

export function amplifyTaint(nodeType: string, state: TaintState): TaintState {
  if (!AI_OUTPUT_NODE_TYPES.has(nodeType) || !isTainted(state)) return state;
  return createTaintState([...state.labels, 'AI_MODEL_OUTPUT'], state.sanitizedFor);
}
