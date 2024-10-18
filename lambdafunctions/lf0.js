import {
  LexRuntimeV2Client,
  RecognizeTextCommand,
} from "@aws-sdk/client-lex-runtime-v2";
import { randomUUID } from "crypto";

const lex = new LexRuntimeV2Client();

// Helper to create an error response
const createError = (code, message) => ({
  code: code,
  message: message,
});

// Helper to create an unstructured message
const createUnstructuredMessage = (id, text, timestamp) => ({
  id: id,
  text: text,
  timestamp: timestamp,
});

// Helper to create a message
const createMessage = (uMessage, type = "unstructured") => ({
  type: type,
  unstructured: uMessage,
});

// Helper to create a bot response
const createBotResponse = (messages) => ({
  messages: messages,
});

// Helper to create simple messages
const createSimpleMessage = (msgs) => {
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
};

// Helper to parse response from Lex
const parseResponse = (response) => {
  const httpStatus = response["$metadata"].httpStatusCode;
  if (response.messages) {
    return response.messages.map((msg) => msg.content);
  } else {
    return ["What can I help you with?"];
  }
};

// Function to send a message to Lex V2
const postToBot = async (event) => {
  const msg = event.messages[0].unstructured.text;

  const params = {
    botId: "GK7NIBALMY",
    botAliasId: "AZLT3O977Y",
    localeId: "en_US",
    sessionId: "testsession",
    text: msg,
  };

  try {
    const command = new RecognizeTextCommand(params);

    const response = await lex.send(command);
    console.log(`Received response from Lex: ${JSON.stringify(response)}`);

    return parseResponse(response);
  } catch (error) {
    console.error("Error communicating with Lex:", error);
    throw error;
  }
};

// Lambda handler function
export const handler = async (event) => {
  console.log("lf0 triggered with payload:", JSON.stringify(event));

  try {
    const responseMessage = await postToBot(event);
    const response = createSimpleMessage(responseMessage);
    return response;
  } catch (error) {
    console.log(error);
    return createError(500, "Internal Server Error");
  }
};
