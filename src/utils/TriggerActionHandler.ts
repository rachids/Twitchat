import store, { PermissionsData, TriggerActionChatCommandData, TriggerActionTypes } from '@/store';
import { IRCEventDataList } from '@/utils/IRCEvent';
import OBSWebsocket from '@/utils/OBSWebsocket';
import { JsonObject } from 'type-fest';
import IRCClient from './IRCClient';
import PublicAPI from './PublicAPI';
import SpotifyHelper, {SearchTrackItem} from './SpotifyHelper';
import TwitchatEvent from './TwitchatEvent';
import TwitchUtils from './TwitchUtils';
import Utils from './Utils';

/**
* Created : 22/04/2022 
*/
export default class TriggerActionHandler {

	private static _instance:TriggerActionHandler;

	private actionsSpool:MessageTypes[] = [];
	private userCooldowns:{[key:string]:number} = {};
	private globalCooldowns:{[key:string]:number} = {};
	private currentSpoolGUID:number = 0;
	
	constructor() {
	
	}
	
	/********************
	* GETTER / SETTERS *
	********************/
	static get instance():TriggerActionHandler {
		if(!TriggerActionHandler._instance) {
			TriggerActionHandler._instance = new TriggerActionHandler();
			TriggerActionHandler._instance.initialize();
		}
		return TriggerActionHandler._instance;
	}
	
	
	
	/******************
	* PUBLIC METHODS *
	******************/
	public onMessage(message:MessageTypes, testMode:boolean = false):void {
		if(testMode) {
			this.actionsSpool = [message];
			this.executeNext(testMode);
		}else{
			this.actionsSpool.push(message);
			if(this.actionsSpool.length == 1) {
				this.executeNext();
			}
		}
	}
	
	private async executeNext(testMode:boolean = false):Promise<void>{
		this.currentSpoolGUID ++;
		const message = this.actionsSpool[0];
		if(!message) return;

		if((message.type == "message" || message.type == "highlight")) {
			switch(message.tags["msg-id"]) {
				case "follow": this.handleFollower(message, testMode, this.currentSpoolGUID); return;

				case "sub": 
				case "resub": 
				case "giftpaidupgrade": this.handleSub(message, testMode, this.currentSpoolGUID); return;
				
				case "subgift": this.handleSubgift(message, testMode, this.currentSpoolGUID); return;

				case "raid": this.handleRaid(message, testMode, this.currentSpoolGUID); return;
			}

			if(message.reward) {
				if(await this.handleReward(message as IRCEventDataList.Highlight, testMode, this.currentSpoolGUID)) {
					return;
				}
			}else 
			if(message.tags.bits) {
				if(await this.handleBits(message, testMode, this.currentSpoolGUID)) {
					return;
				}
			}else{

				if(message.tags["first-msg"] === true) {
					if(await this.handleFirstMessageEver(message, testMode, this.currentSpoolGUID)) {
						// return;
					}
				}else 
				if(message.firstMessage === true) {
					if(await this.handleFirstMessageToday(message, testMode, this.currentSpoolGUID)) {
						// return;
					}
				}
				if(message.message) {
					if(await this.handleChatCmd(message as IRCEventDataList.Message, testMode, this.currentSpoolGUID)) {
						// return;
					}
				}
			}

		}else if(message.type == "prediction") {
			if(await this.handlePrediction(message, testMode, this.currentSpoolGUID)) {
				return;
			}
		
		}else if(message.type == "poll") {
			this.handlePoll(message, testMode, this.currentSpoolGUID);
			return;
		
		}else if(message.type == "bingo") {
			this.handleBingo(message, testMode, this.currentSpoolGUID);
			return;

		}else if(message.type == "raffle") {
			this.handleRaffle(message, testMode, this.currentSpoolGUID);
			return;
		}

		this.actionsSpool.shift();
		this.executeNext();
	}

	
	
	/*******************
	* PRIVATE METHODS *
	*******************/
	private initialize():void {
		
	}

	private async handleFirstMessageEver(message:IRCEventDataList.Message|IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		return this.parseSteps(TriggerTypes.FIRST_ALL_TIME, message, testMode, guid);
	}
	
	private async handleFirstMessageToday(message:IRCEventDataList.Message|IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		return this.parseSteps(TriggerTypes.FIRST_TODAY, message, testMode, guid);
	}
	
	private async handleBits(message:IRCEventDataList.Message|IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		return this.parseSteps(TriggerTypes.BITS, message, testMode, guid);
	}
	
	private async handleFollower(message:IRCEventDataList.Message|IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		return this.parseSteps(TriggerTypes.FOLLOW, message, testMode, guid);
	}
	
	private async handleSub(message:IRCEventDataList.Message|IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		return this.parseSteps(TriggerTypes.SUB, message, testMode, guid);
	}
	
	private async handleSubgift(message:IRCEventDataList.Message|IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		return this.parseSteps(TriggerTypes.SUBGIFT, message, testMode, guid);
	}
	
	private async handlePoll(message:IRCEventDataList.PollResult, testMode:boolean, guid:number):Promise<boolean> {
		let winnerVotes = 0;
		message.data.choices.forEach(v=>{
			if(v.votes > winnerVotes) {
				winnerVotes = v.votes;
				message.winner = v.title;
			}
		});
		return this.parseSteps(TriggerTypes.POLL_RESULT, message, testMode, guid);
	}
	
	private async handlePrediction(message:IRCEventDataList.PredictionResult, testMode:boolean, guid:number):Promise<boolean> {
		message.data.outcomes.forEach(v=>{
			if(v.id == message.data.winning_outcome_id) {
				message.winner = v.title;
			}
		});
		return this.parseSteps(TriggerTypes.PREDICTION_RESULT, message, testMode, guid);
	}
	
	private async handleBingo(message:IRCEventDataList.BingoResult, testMode:boolean, guid:number):Promise<boolean> {
		message.winner = message.data.winners[0];
		return this.parseSteps(TriggerTypes.BINGO_RESULT, message, testMode, guid);
	}
	
	private async handleRaffle(message:IRCEventDataList.RaffleResult, testMode:boolean, guid:number):Promise<boolean> {
		message.winner = message.data.winners[0];
		return this.parseSteps(TriggerTypes.RAFFLE_RESULT, message, testMode, guid);
	}
	
	private async handleRaid(message:IRCEventDataList.Message|IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		return this.parseSteps(TriggerTypes.RAID, message, testMode, guid);
	}
	
	private async handleChatCmd(message:IRCEventDataList.Message, testMode:boolean, guid:number):Promise<boolean> {
		const cmd = message.message.trim().split(" ")[0].toLowerCase();
		return this.parseSteps(TriggerTypes.CHAT_COMMAND, message, testMode, guid, cmd);
	}
	
	private async handleReward(message:IRCEventDataList.Highlight, testMode:boolean, guid:number):Promise<boolean> {
		if(message.reward) {
			let id = message.reward.redemption.reward.id;
			if(id == "TEST_ID") {
				id = TriggerTypes.REWARD_REDEEM;
			}else{
				id = TriggerTypes.REWARD_REDEEM+"_"+id;
			}
			return await this.parseSteps(id, message, testMode, guid);
		}
		return false;
	}

	/**
	 * Executes the steps of the trigger
	 * 
	 * @param eventType 
	 * @param message 
	 */
	private async parseSteps(eventType:string, message:MessageTypes, testMode:boolean, guid:number, subEvent?:string):Promise<boolean> {
		if(subEvent) eventType += "_"+subEvent
		const steps = store.state.triggers[ eventType ];
		if(!steps) {
			return false;
		}else{
			let actions:TriggerActionTypes[] = [];
			let canExecute = true;

			if(!Array.isArray(steps)) {
				const data = steps as TriggerActionChatCommandData;
				actions = data.actions;
				const m = message as IRCEventDataList.Message;
				const uid = m.tags['user-id'];
				const key = eventType+"_"+uid;
				const now = Date.now();
				
				//check permissions
				if(!Utils.checkPermissions(data.permissions, m.tags)) {
					canExecute = false;
				}else{
					//Apply cooldowns if any
					if(this.globalCooldowns[eventType] > 0 && this.globalCooldowns[eventType] > now) canExecute = false;
					else if(data.cooldown.global > 0) this.globalCooldowns[eventType] = now + data.cooldown.global * 1000;
	
					if(this.userCooldowns[key] > 0 && this.userCooldowns[key] > now) canExecute = false;
					else if(canExecute && data.cooldown.user > 0) this.userCooldowns[key] = now + data.cooldown.user * 1000;
				}

			}else{
				actions = steps;
			}

			if(testMode) canExecute = true;
			
			if(!steps || actions.length == 0) canExecute = false;
			// console.log(steps);
			// console.log(message);
			// console.log(canExecute);
			
			if(canExecute) {
				for (let i = 0; i < actions.length; i++) {
					if(guid != this.currentSpoolGUID) return true;//Stop there, something asked to override the current exec
					const step = actions[i];
					if(step.type == "obs") {
						if(step.text) {
							const text = await this.parseText(eventType, message, step.text as string);
							await OBSWebsocket.instance.setTextSourceContent(step.sourceName, text);
						}
						if(step.url) {
							const url = await this.parseText(eventType, message, step.url as string, true);
							await OBSWebsocket.instance.setBrowserSourceURL(step.sourceName, url);
						}
						if(step.mediaPath) {
							await OBSWebsocket.instance.setMediaSourceURL(step.sourceName, step.mediaPath);
						}
			
						if(step.filterName) {
							OBSWebsocket.instance.setFilterState(step.sourceName, step.filterName, step.show);
						}else{
							OBSWebsocket.instance.setSourceState(step.sourceName, step.show);
						}
					}

					if(step.type == "chat") {
						const text = await this.parseText(eventType, message, step.text as string);
						IRCClient.instance.sendMessage(text);
					}

					if(step.type == "spotify") {
						if(step.spotifyAction == TriggerMusicTypes.ADD_TRACK_TO_QUEUE && message.type == "message") {
							let track:SearchTrackItem|null = null;
							if(/open\.spotify\.com\/track\/.*/gi.test(message.message)) {
								const chunks = message.message.replace(/https?:\/\//gi,"").split(/\/|\?/gi)
								const id = chunks[2];
								track = await SpotifyHelper.instance.getTrackByID(id);
							}else{
								track = await SpotifyHelper.instance.searchTrack(message.message);
							}
							if(track) {
								if(await SpotifyHelper.instance.addToQueue(track.uri)) {
									const data:MusicMessage = {
										type:"music",
										title:track.name,
										artist:track.artists[0].name,
										album:track.album.name,
										cover:track.album.images[0].url,
										duration:track.duration_ms,
									};
									PublicAPI.instance.broadcast(TwitchatEvent.TRACK_ADDED_TO_QUEUE, data);
									this.parseSteps(TriggerTypes.TRACK_ADDED_TO_QUEUE, data, false, guid);
								}
							}
						}else
						
						if(step.spotifyAction == TriggerMusicTypes.NEXT_TRACK) {
							SpotifyHelper.instance.nextTrack();
						}
						
						if(step.spotifyAction == TriggerMusicTypes.PAUSE_PLAYBACK) {
							SpotifyHelper.instance.pause();
						}
						
						if(step.spotifyAction == TriggerMusicTypes.RESUME_PLAYBACK) {
							SpotifyHelper.instance.resume();
						}
					}

					await Utils.promisedTimeout(step.delay * 1000);
				}
			}
		}

		//Remove item done
		this.actionsSpool.shift();
		if(this.actionsSpool.length > 0) {
			this.executeNext();
		}

		return true;
	}

	/**
	 * Replaces placeholders by their values on the message
	 */
	private async parseText(eventType:string, message:MessageTypes, src:string, urlEncode:boolean = false):Promise<string> {
		let res = src;
		eventType = eventType.replace(/_.*$/gi, "");//Remove suffix to get helper for the global type
		const helpers = TriggerActionHelpers[eventType];
		for (let i = 0; i < helpers.length; i++) {
			const h = helpers[i];
			const chunks:string[] = h.pointer.split(".");
			let value = message as unknown;
			try {
				for (let i = 0; i < chunks.length; i++) {
					value = (value as {[key:string]:unknown})[chunks[i]];
				}
			}catch(error) {
				console.warn("Unable to find pointer for helper", h);
				value = "";
			}
			
			if(h.tag === "SUB_TIER") {
				if(!isNaN(value as number) && (value as number) > 0) {
					value = Math.round((value as number)/1000)
				}else{
					value = 1;//Fallback just in case but shouldn't be necessary
				}
			}

			if(h.tag === "MESSAGE") {
				const m = message as IRCEventDataList.Highlight;
				if(m.message) {
					//Parse emotes
					const chunks = TwitchUtils.parseEmotes(m.message as string, m.tags['emotes-raw'], true);
					let cleanMessage = ""
					//only keep text chunks to remove emotes
					for (let i = 0; i < chunks.length; i++) {
						const v = chunks[i];
						if(v.type == "text") {
							cleanMessage += v.value+" ";
						}
					}
					value = cleanMessage.trim();
				}
			}
			
			if(value && eventType === TriggerTypes.BITS && h.tag === "MESSAGE") {
				//Parse cheermotes
				const m = message as IRCEventDataList.Highlight;
				value = await TwitchUtils.parseCheermotes(value as string, m.tags['room-id'] as string);
			}

			if(value && typeof value == "string") {
				//Strip HTML tags (removes emotes and cheermotes)
				value = (value as string).replace(/<\/?\w+(?:\s+[^\s/>"'=]+(?:\s*=\s*(?:".*?[^"\\]"|'.*?[^'\\]'|[^\s>"']+))?)*?>/gi, "");
				
				if(urlEncode) {
					value = encodeURIComponent(value as string);
				}
			}
			if(value == undefined) value = "";
			res = res.replace(new RegExp("\\{"+h.tag+"\\}", "gi"), value as string);
		}
		return res;
	}
}


type MessageTypes = IRCEventDataList.Message
| IRCEventDataList.Highlight
| IRCEventDataList.Message
| IRCEventDataList.PredictionResult
| IRCEventDataList.PollResult
| IRCEventDataList.BingoResult
| IRCEventDataList.RaffleResult
| MusicMessage;

export const TriggerTypes = {
	FIRST_ALL_TIME:"1",
	FIRST_TODAY:"2",
	POLL_RESULT:"3",
	PREDICTION_RESULT:"4",
	RAFFLE_RESULT:"5",
	BINGO_RESULT:"6",
	CHAT_COMMAND:"7",
	SUB:"8",
	SUBGIFT:"9",
	BITS:"10",
	FOLLOW:"11",
	RAID:"12",
	REWARD_REDEEM:"13",
	TRACK_ADDED_TO_QUEUE:"14",
}

export const TriggerActionHelpers:{[key:string]:{tag:string, desc:string, pointer:string}[]} = {};

TriggerActionHelpers[TriggerTypes.FIRST_ALL_TIME] = [
	{tag:"USER", desc:"User name", pointer:"tags.display-name"},
	{tag:"MESSAGE", desc:"Message content", pointer:"message"},
];

TriggerActionHelpers[TriggerTypes.FIRST_TODAY] = [
	{tag:"USER", desc:"User name", pointer:"tags.display-name"},
	{tag:"MESSAGE", desc:"Message content", pointer:"message"},
];

TriggerActionHelpers[TriggerTypes.POLL_RESULT] = [
	{tag:"TITLE", desc:"Poll title", pointer:"data.title"},
	{tag:"WIN", desc:"Winning choice title", pointer:"winner"},
	// {tag:"PERCENT", desc:"Votes percent of the winning choice", pointer:""},
];

TriggerActionHelpers[TriggerTypes.PREDICTION_RESULT] = [
	{tag:"TITLE", desc:"Prediction title", pointer:"data.title"},
	{tag:"WIN", desc:"Winning choice title", pointer:"winner"},
];

TriggerActionHelpers[TriggerTypes.BINGO_RESULT] = [
	{tag:"WINNER", desc:"Winner name", pointer:"winner.display-name"},
];

TriggerActionHelpers[TriggerTypes.RAFFLE_RESULT] = [
	{tag:"WINNER", desc:"Winner name", pointer:"winner.user.display-name"},
];

TriggerActionHelpers[TriggerTypes.CHAT_COMMAND] = [
	{tag:"USER", desc:"User name", pointer:"tags.display-name"},
	{tag:"MESSAGE", desc:"Chat message content", pointer:"message"},
];

TriggerActionHelpers[TriggerTypes.SUB] = [
	{tag:"USER", desc:"User name", pointer:"tags.display-name"},
	{tag:"SUB_TIER", desc:"Sub tier 1, 2 or 3", pointer:"methods.plan"},
	{tag:"MESSAGE", desc:"Message of the user", pointer:"message"},
];

TriggerActionHelpers[TriggerTypes.SUBGIFT] = [
	{tag:"USER", desc:"User name of the sub gifter", pointer:"tags.display-name"},
	{tag:"RECIPIENT", desc:"Recipient user name", pointer:"recipient"},
	{tag:"SUB_TIER", desc:"Sub tier 1, 2 or 3", pointer:"methods.plan"},
	{tag:"MESSAGE", desc:"Message of the user", pointer:"message"},
];

TriggerActionHelpers[TriggerTypes.BITS] = [
	{tag:"USER", desc:"User name", pointer:"tags.display-name"},
	{tag:"BITS", desc:"Number of bits", pointer:"tags.bits"},
	{tag:"MESSAGE", desc:"Message of the user", pointer:"message"},
];

TriggerActionHelpers[TriggerTypes.FOLLOW] = [
	{tag:"USER", desc:"User name of the new follower", pointer:"tags.username"},
];

TriggerActionHelpers[TriggerTypes.RAID] = [
	{tag:"USER", desc:"User name of the new follower", pointer:"username"},
	{tag:"VIEWERS", desc:"Number of viewers", pointer:"viewers"},
];

TriggerActionHelpers[TriggerTypes.REWARD_REDEEM] = [
	{tag:"USER", desc:"User name", pointer:"tags.display-name"},
	{tag:"TITLE", desc:"Reward title", pointer:"reward.redemption.reward.title"},
	{tag:"DESCRIPTION", desc:"Reward description", pointer:"reward.redemption.reward.prompt"},
	{tag:"COST", desc:"Reward cost", pointer:"reward.redemption.reward.cost"},
];
TriggerActionHelpers[TriggerTypes.TRACK_ADDED_TO_QUEUE] = [
	{tag:"ARTIST", desc:"Artist name", pointer:"artist"},
	{tag:"TITLE", desc:"Track title", pointer:"title"},
	{tag:"ALBUM", desc:"Album name", pointer:"album"},
	{tag:"COVER", desc:"Cover image URL", pointer:"cover"},
];

export interface TriggerEventTypes {
	label:string;
	value:string;
	isCategory?:boolean,
	jsonTest?:unknown,
	command?:string,
	permissions?:PermissionsData,
	cooldown?:{global:number, user:number},
	[paramater: string]: unknown;
}

export const OBSTriggerEvents:TriggerEventTypes[] = [
	{label:"Chat command", value:TriggerTypes.CHAT_COMMAND, isCategory:true, jsonTest:{"type":"message","message":"!test","tags":{"badge-info":{"subscriber":"13"},"badges":{"broadcaster":"1","subscriber":"12"},"color":"#9ACD32","display-name":"Durss","emote-sets":"","mod":false,"subscriber":true,"user-type":null,"badge-info-raw":"subscriber/13","badges-raw":"broadcaster/1,subscriber/12","username":"durss","emotes":{},"emotes-raw":null,"message-type":"chat","id":"00000000-0000-0000-0000-000000000004","tmi-sent-ts":"1650938130680"},"channel":"#durss","self":true}},
	{label:"Channel point reward", value:TriggerTypes.REWARD_REDEEM, isCategory:true, jsonTest:{"reward":{"timestamp":"2022-04-25T22:54:53.897356718Z","redemption":{"user":{"id":"29961813","login":"durss","display_name":"Durss"},"reward":{"id":"TEST_ID","channel_id":"29961813","title":"Text reward","prompt":"This is a reward description","cost":1000},"status":"UNFULFILLED"}},"tags":{"username":"Durss","display-name":"Durss","id":"bdeddedd-6184-4b26-a74e-87a5ff99a1be","user-id":"29961813","tmi-sent-ts":"1650927293897","message-type":"chat","room-id":"29961813"},"type":"highlight"}},
	{label:"First message of a user all time", value:TriggerTypes.FIRST_ALL_TIME, jsonTest:{"type":"message","message":"This is my first message here !","tags":{"badges":{"premium":"1"},"client-nonce":"004c878edd9adf5b36717d6454db1b7c","color":"#9ACD32","display-name":"Durss","emote-only":true,"emotes":{},"first-msg":true,"flags":null,"id":"c5c54086-d0b5-4809-976a-254f4d206248","mod":false,"room-id":"121652526","subscriber":false,"tmi-sent-ts":"1642377332605","turbo":false,"user-id":"92203285","user-type":null,"emotes-raw":"","badge-info-raw":null,"badges-raw":"premium/1","username":"durss","message-type":"chat"},"channel":"#durss","self":false,}},
	{label:"First message of a user today", value:TriggerTypes.FIRST_TODAY, jsonTest:{"type":"message","message":"This is my first message for today!","tags":{"badges":{"premium":"1"},"client-nonce":"004c878edd9adf5b36717d6454db1b7c","color":"#9ACD32","display-name":"Durss","emote-only":true,"emotes":{},"first-msg":false,"flags":null,"id":"c5c54086-d0b5-4809-976a-254f4d206248","mod":false,"room-id":"121652526","subscriber":false,"tmi-sent-ts":"1642377332605","turbo":false,"user-id":"92203285","user-type":null,"emotes-raw":"","badge-info-raw":null,"badges-raw":"premium/1","username":"durss","message-type":"chat"},"channel":"#durss","self":false}},
	{label:"Poll result", value:TriggerTypes.POLL_RESULT, jsonTest:{"tags":{"id":"00000000-0000-0000-0001-000000000034"},"type":"poll","data":{"id":"3c96966e-9141-4d0d-98fe-8e417301144c","broadcaster_id":"29961813","broadcaster_name":"durss","broadcaster_login":"durss","title":"Which option is the best?","choices":[{"id":"b2dc37a4-6469-41f3-9d09-57644cc813b3","title":"This one","votes":2,"channel_points_votes":450,"bits_votes":0},{"id":"a1b43c9c-b52a-4885-9d4e-2c2c0d99218b","title":"That one","votes":5,"channel_points_votes":250,"bits_votes":0}],"bits_voting_enabled":false,"bits_per_vote":0,"channel_points_voting_enabled":false,"channel_points_per_vote":0,"status":"COMPLETED","duration":60,"started_at":"2022-02-16T17:59:57.589127933Z","ended_at":"2022-02-16T18:00:57.589127933Z"}}},
	{label:"Prediction result", value:TriggerTypes.PREDICTION_RESULT, jsonTest:{"tags":{"id":"00000000-0000-0000-0001-000000000017"},"type":"prediction","data":{"id":"09ced600-a679-45c5-ad50-4979090f6db1","broadcaster_id":"29961813","broadcaster_name":"Durss","broadcaster_login":"durss","title":"Is Twitchat amazing?","winning_outcome_id":"a9753995-f25d-40d1-81cd-a9b7605b58d7","outcomes":[{"id":"a9753995-f25d-40d1-81cd-a9b7605b58d7","title":"OMG YES","users":1,"channel_points":80,"top_predictors":[{"user_id":"647389082","user_login":"durssbot","user_name":"DurssBot","channel_points_used":80,"channel_points_won":0}],"color":"BLUE"},{"id":"7a483df8-3ec8-4e15-8e9a-da64fc574ad9","title":"it's ok","users":1,"channel_points":188,"top_predictors":[{"user_id":"29961813","user_login":"durss","user_name":"Durss","channel_points_used":188,"channel_points_won":0}],"color":"PINK"}],"prediction_window":30,"status":"RESOLVED","created_at":"2022-02-17T19:10:55.130396565Z","ended_at":"2022-02-17T19:11:30.109908422Z","locked_at":"2022-02-17T19:11:24.804100656Z"}}},
	{label:"Raffle result", value:TriggerTypes.RAFFLE_RESULT, jsonTest:{"type":"raffle","data":{"command":"!raffle","duration":10,"maxUsers":0,"created_at":1650674437311,"users":[{"score":1,"user":{"badge-info":{"subscriber":"13"},"badges":{"broadcaster":"1","subscriber":"12"},"color":"#9ACD32","display-name":"Durss","emote-sets":"","mod":false,"subscriber":true,"user-type":null,"badge-info-raw":"subscriber/13","badges-raw":"broadcaster/1,subscriber/12","username":"durss","emotes":{},"emotes-raw":null,"message-type":"chat","id":"00000000-0000-0000-0000-000000000002","tmi-sent-ts":"1650674440278"}}],"followRatio":0,"vipRatio":0,"subRatio":0,"subgitRatio":0,"winners":[{"score":1,"user":{"badge-info":{"subscriber":"13"},"badges":{"broadcaster":"1","subscriber":"12"},"color":"#9ACD32","display-name":"Durss","emote-sets":"","mod":false,"subscriber":true,"user-type":null,"badge-info-raw":"subscriber/13","badges-raw":"broadcaster/1,subscriber/12","username":"durss","emotes":{},"emotes-raw":null,"message-type":"chat","id":"00000000-0000-0000-0000-000000000002","tmi-sent-ts":"1650674440278"}}]},"tags":{"id":"00000000-0000-0000-0000-000000000003","tmi-sent-ts":"1650674447187"},"winner":{"score":1,"user":{"badge-info":{"subscriber":"13"},"badges":{"broadcaster":"1","subscriber":"12"},"color":"#9ACD32","display-name":"Durss","emote-sets":"","mod":false,"subscriber":true,"user-type":null,"badge-info-raw":"subscriber/13","badges-raw":"broadcaster/1,subscriber/12","username":"durss","emotes":{},"emotes-raw":null,"message-type":"chat","id":"00000000-0000-0000-0000-000000000002","tmi-sent-ts":"1650674440278"}}}},
	{label:"Bingo result", value:TriggerTypes.BINGO_RESULT, jsonTest:{"type":"bingo","data":{"guessNumber":true,"guessEmote":false,"numberValue":6,"opened":true,"winners":[{"badge-info":{"subscriber":"13"},"badges":{"broadcaster":"1","subscriber":"12"},"color":"#9ACD32","display-name":"Durss","emote-sets":"","mod":false,"subscriber":true,"user-type":null,"badge-info-raw":"subscriber/13","badges-raw":"broadcaster/1,subscriber/12","username":"durss","emotes":{},"emotes-raw":null,"message-type":"chat","id":"00000000-0000-0000-0000-000000000005","tmi-sent-ts":"1650674495186"}]},"tags":{"id":"00000000-0000-0000-0000-000000000006","tmi-sent-ts":"1650674495236"},"winner":{"badge-info":{"subscriber":"13"},"badges":{"broadcaster":"1","subscriber":"12"},"color":"#9ACD32","display-name":"Durss","emote-sets":"","mod":false,"subscriber":true,"user-type":null,"badge-info-raw":"subscriber/13","badges-raw":"broadcaster/1,subscriber/12","username":"durss","emotes":{},"emotes-raw":null,"message-type":"chat","id":"00000000-0000-0000-0000-000000000005","tmi-sent-ts":"1650674495186"}}},
	{label:"Sub", value:TriggerTypes.SUB, jsonTest:{"type":"highlight","channel":"#durss","username":"Durss","methods":{"prime":true,"plan":"Prime","planName":"Be a Little Whale !"},"tags":{"badge-info":{"subscriber":"0"},"badges":{"subscriber":"0","premium":"1"},"color":"#9ACD32","display-name":"Durss","emotes":null,"flags":null,"id":"639779e0-37b0-4e31-9045-2ee8f21f0b34","login":"durss","mod":false,"msg-id":"sub","msg-param-cumulative-months":true,"msg-param-months":false,"msg-param-multimonth-duration":false,"msg-param-multimonth-tenure":false,"msg-param-should-share-streak":false,"msg-param-sub-plan-name":"Be a Little Whale !","msg-param-sub-plan":"Prime","msg-param-was-gifted":"false","room-id":"121652526","subscriber":true,"system-msg":"durss subscribed with Prime.","tmi-sent-ts":"1642377377050","user-id":"29961813","user-type":null,"emotes-raw":null,"badge-info-raw":"subscriber/0","badges-raw":"subscriber/0,premium/1","message-type":"sub"},"message":"Woop wooooooop !"}},
	{label:"Subgift", value:TriggerTypes.SUBGIFT, jsonTest:{"type":"highlight","channel":"#durss","username":"Durss","methods":{"prime":false,"plan":"3000","planName":"SUBSCRIBER"},"months":0,"tags":{"badge-info":{"subscriber":"12"},"badges":{"subscriber":"3012","sub-gifter":"5"},"color":"#9ACD32","display-name":"Durss","emotes":null,"flags":null,"id":"51e48d26-836b-409c-ac7f-708e84ccc5b1","login":"durss","mod":false,"msg-id":"subgift","msg-param-gift-months":true,"msg-param-months":true,"msg-param-origin-id":"cf 8a 7f a4 b1 9f ac e4 9f bc ac c8 c2 30 b3 5d 0c 84 c7 b1","msg-param-recipient-display-name":"Durssbot","msg-param-recipient-id":"452550058","msg-param-recipient-user-name":"Durssbot","msg-param-sender-count":false,"msg-param-sub-plan-name":"SUBSCRIBER","msg-param-sub-plan":"1000","room-id":"29961813","subscriber":true,"system-msg":"durss gifted a Tier 1 sub to Durssbot!","tmi-sent-ts":"1642377361661","user-id":"156668532","user-type":null,"emotes-raw":null,"badge-info-raw":"subscriber/12","badges-raw":"subscriber/3012,sub-gifter/5","message-type":"subgift"},"recipient":"Durssbot",}},
	{label:"Bits", value:TriggerTypes.BITS, jsonTest:{"type":"highlight","channel":"#durss","tags":{"badge-info":{"subscriber":"1"},"badges":{"subscriber":"0"},"bits":"51275","color":"#9ACD32","display-name":"Durss","emotes":{},"first-msg":false,"flags":null,"id":"2a1279df-d092-4f87-a2bc-a9123d64f39c","mod":false,"room-id":"29961813","subscriber":true,"tmi-sent-ts":"1642379087259","turbo":false,"user-id":"29961813","user-type":null,"emotes-raw":"","badge-info-raw":"subscriber/1","badges-raw":"subscriber/0","username":"durss","message-type":"chat"},"message":"Here are 51275 bits for you! Cheer1050 Cheer25 Corgo50000 Anon100 Muxy100"}},
	{label:"Follow", value:TriggerTypes.FOLLOW, jsonTest:{"channel":"#durss","tags":{"username":"Durss","user-id":"29961813","tmi-sent-ts":"1644088397887","id":"00000000-0000-0000-0001-000000000000","msg-id":"follow"},"username":"Durss","type":"highlight"}},
	{label:"Raid", value:TriggerTypes.RAID, jsonTest:{"type":"highlight","channel":"#durss","tags":{"info":"this tags prop is a fake one to make things easier for my code","id":"16423778121330.0751974390273129","tmi-sent-ts":"1642377812133","msg-id":"raid"},"username":"Durss","viewers":727}},
	{label:"Track added to queue", value:TriggerTypes.TRACK_ADDED_TO_QUEUE, jsonTest:{ "title": "Mitchiri neko march", "artist": "Mitchiri neko fanfare", "album": "Mitchiri neko march", "cover": "https://i.scdn.co/image/ab67616d0000b2735b2419cbca2c5f1935743722", "duration": 192469 }},
]

export interface MusicMessage extends JsonObject{
	type:"music",
	title:string,
	artist:string,
	album:string,
	cover:string,
	duration:number,
}

export const TriggerMusicTypes = {
	ADD_TRACK_TO_QUEUE:"1",
	NEXT_TRACK:"2",
	PAUSE_PLAYBACK:"3",
	RESUME_PLAYBACK:"4",
}

export const MusicTriggerEvents:TriggerEventTypes[] = [
	{label:"Add a track to the queue", value:TriggerMusicTypes.ADD_TRACK_TO_QUEUE},
	{label:"Play next track", value:TriggerMusicTypes.NEXT_TRACK},
	{label:"Pause playback", value:TriggerMusicTypes.PAUSE_PLAYBACK},
	{label:"Resume playback", value:TriggerMusicTypes.RESUME_PLAYBACK},
]