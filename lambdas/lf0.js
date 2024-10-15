import {
  LexRuntimeV2Client,
  RecognizeTextCommand,
} from "@aws-sdk/client-lex-runtime-v2";
// import { v4 as uuidv4 } from "uuid";
import { randomUUID } from "crypto";
const lex = new LexRuntimeV2Client();

// Helper to create an error response
function createError(code, message) {
  return {
    code: code,
    message: message,
  };
}

// Helper to create an unstructured message
function createUnstructuredMessage(id, text, timestamp) {
  return {
    id: id,
    text: text,
    timestamp: timestamp,
  };
}

// Helper to create a message
function createMessage(uMessage, type = "unstructured") {
  return {
    type: type,
    unstructured: uMessage,
  };
}

// Helper to create a bot response
function createBotResponse(messages) {
  return { messages: messages };
}

// Helper to create simple messages
function createSimpleMessage(msgs) {
  const parsedMessages = msgs.map((msg) => {
    const timestamp = Date.now();
    const unstructured = createUnstructuredMessage(
      randomUUID(),
      msg,
      timestamp
    );
    return createMessage(unstructured);
  });
  return createBotResponse(parsedMessages);
}

// Helper to parse response from Lex
function parseResponse(response) {
  const httpStatus = response["$metadata"].httpStatusCode;
  if (response.messages) {
    return response.messages.map((msg) => msg.content);
  } else {
    return ["What can I help you with?"];
  }
}

// Function to send a message to Lex V2
async function postToBot(event) {
  const msg = event.messages[0].unstructured.text;
  console.log(`Parsed message: ${msg}`);

  const params = {
    botId: "GK7NIBALMY",
    botAliasId: "AZLT3O977Y",
    localeId: "en_US",
    sessionId: "testsession",
    text: msg,
  };

  try {
    // const response = await lex.recognizeText(params).promise();
    const command = new RecognizeTextCommand(params);
    const response = await lex.send(command);
    console.log(`Received response from Lex: ${JSON.stringify(response)}`);
    return parseResponse(response);
  } catch (error) {
    console.error("Error communicating with Lex:", error);
    throw error;
  }
}

// Lambda handler function
export const handler = async (event) => {
  console.log("lf0");
  console.log(`Event: ${JSON.stringify(event)}`);

  try {
    const responseMessage = await postToBot(event);
    const response = createSimpleMessage(responseMessage);
    console.log("returning response");
    return response;
  } catch (error) {
    console.log(error);
    return createError(500, "Internal Server Error");
  }
};
