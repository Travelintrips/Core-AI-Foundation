import { randomUUID } from "crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { aiCodingBridgeCommandsTable, aiCodingBridgePresenceTable, aiCodingBridgeResponsesTable, db } from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { notifyCodingBridgeResponse } from "./codingWhatsappNotificationService.js";
const DEFAULT_LEASE_SECONDS = 180;
const MAX_LEASE_SECONDS = 300;

export async function submitCodingBridgeCommand(input: { externalCommandId:string; instruction:string; taskId?:string|null; source?:string; commandType?:string; authority?:Record<string,unknown>; metadata?:Record<string,unknown> }) {
 const source=input.source ?? "chatgpt";
 const [existing]=await db.select().from(aiCodingBridgeCommandsTable).where(and(eq(aiCodingBridgeCommandsTable.source,source),eq(aiCodingBridgeCommandsTable.externalCommandId,input.externalCommandId))).limit(1);
 if(existing) return {command:existing,created:false};
 const [command]=await db.insert(aiCodingBridgeCommandsTable).values({taskId:input.taskId??null,externalCommandId:input.externalCommandId,source,commandType:input.commandType??"INSTRUCTION",instruction:input.instruction,authorityJson:input.authority??{},metadataJson:input.metadata??{}}).returning();
 if(!command) throw new Error("Failed to persist bridge command");
 await db.insert(aiCodingBridgeResponsesTable).values({commandId:command.id,taskId:command.taskId,kind:"ACK",message:"Command received by AI Core.",checkpointJson:{status:command.status}});
 publishSafe({eventType:"coding.bridge.command.received",sourceModule:"coding-control-bridge",sourceId:command.id,correlationId:command.id,payload:{commandId:command.id,taskId:command.taskId,commandType:command.commandType}});
 return {command,created:true};
}
export async function appendCodingBridgeResponse(input:{commandId:string;taskId?:string|null;kind:"ACK"|"PROGRESS"|"CHECKPOINT"|"BLOCKER"|"COMPLETED"|"FAILED";message:string;checkpoint?:Record<string,unknown>;metadata?:Record<string,unknown>}) {
 const [response]=await db.insert(aiCodingBridgeResponsesTable).values({commandId:input.commandId,taskId:input.taskId??null,kind:input.kind,message:input.message,checkpointJson:input.checkpoint??{},metadataJson:input.metadata??{}}).returning();
 if(!response) throw new Error("Failed to persist bridge response");
 publishSafe({eventType:"coding.bridge.response.created",sourceModule:"coding-control-bridge",sourceId:response.id,correlationId:input.commandId,payload:{responseId:response.id,commandId:input.commandId,kind:input.kind}});
 void notifyCodingBridgeResponse({
  responseId: response.id,
  commandId: input.commandId,
  taskId: input.taskId ?? null,
  kind: input.kind,
  message: input.message,
 });
 return response;
}
export async function listPendingCodingBridgeResponses(limit=50){return db.select().from(aiCodingBridgeResponsesTable).where(isNull(aiCodingBridgeResponsesTable.acknowledgedAt)).orderBy(asc(aiCodingBridgeResponsesTable.createdAt)).limit(Math.max(1,Math.min(100,limit)));}
export async function acknowledgeCodingBridgeResponse(id:string){const [row]=await db.update(aiCodingBridgeResponsesTable).set({acknowledgedAt:new Date()}).where(eq(aiCodingBridgeResponsesTable.id,id)).returning();return row??null;}
export async function renewCodingBridgePresence(input:{clientId:string;source?:string;leaseSeconds?:number;metadata?:Record<string,unknown>}) {
 const seconds=Math.max(30,Math.min(MAX_LEASE_SECONDS,input.leaseSeconds??DEFAULT_LEASE_SECONDS)); const now=new Date(); const leaseExpiresAt=new Date(now.getTime()+seconds*1000); const leaseToken=randomUUID();
 const insertValues={clientId:input.clientId,source:input.source??"chatgpt",leaseToken,leaseExpiresAt,lastSeenAt:now,metadataJson:input.metadata??{}};
 const updateValues={source:input.source??"chatgpt",leaseToken,leaseExpiresAt,lastSeenAt:now,metadataJson:input.metadata??{},updatedAt:now};
 const [row]=await db.insert(aiCodingBridgePresenceTable).values(insertValues).onConflictDoUpdate({target:aiCodingBridgePresenceTable.clientId,set:updateValues}).returning();
 if(!row) throw new Error("Failed to renew bridge presence"); return row;
}
export async function getCodingBridgeAvailability(clientId:string){const [row]=await db.select().from(aiCodingBridgePresenceTable).where(eq(aiCodingBridgePresenceTable.clientId,clientId)).limit(1);if(!row)return{clientId,state:"UNAVAILABLE" as const,leaseExpiresAt:null,lastSeenAt:null};return{clientId,state:row.leaseExpiresAt.getTime()>Date.now()?"ACTIVE" as const:"UNAVAILABLE" as const,leaseExpiresAt:row.leaseExpiresAt,lastSeenAt:row.lastSeenAt};}
