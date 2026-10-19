import { channelContract } from "@backlabs/testing";
import { chatwootChannel } from "../src/index.ts";

/**
 * Runs the ChannelPort contract against a real Chatwoot. Skipped unless these
 * are set, e.g. against a local Chatwoot:
 *
 *   CHATWOOT_CONTRACT_URL           http://localhost:3001
 *   CHATWOOT_CONTRACT_ACCOUNT_ID    1
 *   CHATWOOT_CONTRACT_BOT_TOKEN     Agent Bot access token
 *   CHATWOOT_CONTRACT_READ_TOKEN    a user access token
 *   CHATWOOT_CONTRACT_CONVERSATION  display id of a throwaway conversation
 */
const env = {
	url: process.env.CHATWOOT_CONTRACT_URL,
	accountId: process.env.CHATWOOT_CONTRACT_ACCOUNT_ID,
	botToken: process.env.CHATWOOT_CONTRACT_BOT_TOKEN,
	readToken: process.env.CHATWOOT_CONTRACT_READ_TOKEN,
	conversationId: process.env.CHATWOOT_CONTRACT_CONVERSATION,
};

channelContract(
	"Chatwoot",
	async () => ({
		channel: chatwootChannel({
			baseUrl: env.url ?? "",
			accountId: Number(env.accountId),
			botToken: env.botToken ?? "",
			readToken: env.readToken ?? "",
		}),
		conversationId: env.conversationId ?? "",
	}),
	{ skip: Object.values(env).some((value) => !value) },
);
