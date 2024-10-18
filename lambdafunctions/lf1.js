import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const sqs = new SQSClient();

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

const CACHE_TABLE_NAME = "search-cache";

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;

// Helpers that build all of the responses

const elicitSlot = (
  sessionAttributes,
  intentName,
  slots,
  slotToElicit,
  message
) => ({
  sessionState: {
    sessionAttributes: sessionAttributes,
    intent: {
      name: intentName,
      slots: slots,
      state: "InProgress",
    },
    dialogAction: {
      type: "ElicitSlot",
      slotToElicit: slotToElicit,
    },
  },
  messages: [
    {
      contentType: "PlainText",
      content: message,
    },
  ],
});

const close = (sessionAttributes, fulfillmentState, message, intentName) => ({
  sessionState: {
    sessionAttributes: sessionAttributes,
    intent: {
      name: intentName,
      state: fulfillmentState,
    },
    dialogAction: {
      type: "Close",
    },
  },
  messages: [
    {
      contentType: "PlainText",
      content: message,
    },
  ],
});

// General Helper Functions

const safeInt = (n) => (n ? parseInt(n) : null);

const evalExpression = (expr) => {
  try {
    return expr();
  } catch (err) {
    return null;
  }
};

const formatDate = (dateString) => {
  const options = {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "2-digit",
  };
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", options);
};

const buildValidationResult = (isValid, violatedSlot, messageContent) => ({
  isValid: isValid,
  violatedSlot: violatedSlot,
  message: {
    contentType: "PlainText",
    content: messageContent,
  },
});

// Helper Functions to validate slot values

const isValidCity = (city) => {
  const validCities = ["new york", "nyc", "manhattan"];
  return validCities.includes(city.toLowerCase());
};

const isValidCuisine = (cuisine) => {
  const validCuisines = ["japanese", "mexican", "indian", "chinese", "italian"];
  return validCuisines.includes(cuisine.toLowerCase());
};

const isValidDate = (date) => !isNaN(Date.parse(date));

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateDining(slots) {
  const location = evalExpression(
    () =>
      slots.Location.value.interpretedValue ||
      slots.Location.value.originalValue
  );
  const cuisine = evalExpression(
    () =>
      slots.CuisineType.value.interpretedValue ||
      slots.CuisineType.value.originalValue
  );
  const count = safeInt(
    evalExpression(
      () =>
        slots.NoOfPeople.value.interpretedValue ||
        slots.NoOfPeople.value.originalValue
    )
  );
  const date = evalExpression(
    () => slots.Date.value.interpretedValue || slots.Date.value.originalValue
  );
  const time = evalExpression(
    () => slots.Time.value.interpretedValue || slots.Time.value.originalValue
  );
  const email = evalExpression(
    () => slots.Email.value.interpretedValue || slots.Email.value.originalValue
  );

  if (!location) {
    return buildValidationResult(
      false,
      "Location",
      "Where are you looking to eat?"
    );
  } else if (!isValidCity(location)) {
    return buildValidationResult(
      false,
      "Location",
      `We currently do not support \'${location}\'. Can you try a different city?`
    );
  }

  if (!cuisine) {
    return buildValidationResult(
      false,
      "CuisineType",
      "What type of cuisine are you looking for?"
    );
  } else if (!isValidCuisine(cuisine)) {
    return buildValidationResult(
      false,
      "CuisineType",
      `We currently do not support \'${cuisine}\'. Can you try a different cuisine?`
    );
  }

  if (!count) {
    return buildValidationResult(
      false,
      "NoOfPeople",
      "How many people will be dining?"
    );
  } else if (count < 1 || count > 8) {
    return buildValidationResult(
      false,
      "NoOfPeople",
      "I'm sorry, but you can make a reservation for 1 to 8 guests. How many guests?"
    );
  }

  if (!date) {
    return buildValidationResult(
      false,
      "Date",
      "What date would you like to make your reservation?"
    );
  } else if (!isValidDate(date)) {
    return buildValidationResult(
      false,
      "Date",
      "I did not understand your reservation date. When would you like to make your reservation?"
    );
  }

  if (!time) {
    return buildValidationResult(
      false,
      "Time",
      "What time do you plan to dine?"
    );
  }

  if (!email) {
    return buildValidationResult(
      false,
      "Email",
      "Please provide your email address."
    );
  } else if (!isValidEmail(email)) {
    return buildValidationResult(
      false,
      "Email",
      "Please provide a valid email address."
    );
  }

  return { isValid: true };
}

// Query dynamodb for cache
const queryDynamoDB = async (sessionId) => {
  try {
    const getParams = {
      TableName: CACHE_TABLE_NAME,
      Key: {
        sessionId: sessionId,
      },
    };
    const result = await dynamodb.send(new GetCommand(getParams));
    console.log("fetched item from dynamodb:", result.Item);
    return result.Item || {};
  } catch (error) {
    console.error("Error fetching cache from dynamoDB:", error);
    return {};
  }
};

const storeSearchInCache = async (slots, sessionId) => {
  try {
    const item = {
      sessionId: sessionId,
      Location:
        slots.Location.value.interpretedValue ||
        slots.Location.value.originalValue,
      CuisineType:
        slots.CuisineType.value.interpretedValue ||
        slots.CuisineType.value.originalValue,
      NoOfPeople:
        slots.NoOfPeople.value.interpretedValue ||
        slots.NoOfPeople.value.originalValue,
      Date: slots.Date.value.interpretedValue || slots.Date.value.originalValue,
      Time: slots.Time.value.interpretedValue || slots.Time.value.originalValue,
      Email:
        slots.Email.value.interpretedValue || slots.Email.value.originalValue,
    };

    const putParams = {
      TableName: CACHE_TABLE_NAME,
      Item: item,
    };

    await dynamodb.send(new PutCommand(putParams));
  } catch (error) {
    console.error("Error storing preferences data in cache:", error);
  }
};

const updateCache = async (slots, sessionId) => {
  try {
    const params = {
      TableName: CACHE_TABLE_NAME,
      Key: {
        sessionId: sessionId,
      },
      UpdateExpression:
        "set #loc = :newLocation, CuisineType = :newCuisineType, NoOfPeople = :newNoOfPeople, #dt = :newDt, #tm = :newTm, #em = :newEmail",
      ExpressionAttributeValues: {
        ":newLocation":
          slots.Location.value.interpretedValue ||
          slots.Location.value.originalValue,
        ":newCuisineType":
          slots.CuisineType.value.interpretedValue ||
          slots.CuisineType.value.originalValue,
        ":newNoOfPeople":
          slots.NoOfPeople.value.interpretedValue ||
          slots.NoOfPeople.value.originalValue,
        ":newDt":
          slots.Date.value.interpretedValue || slots.Date.value.originalValue,
        ":newTm":
          slots.Time.value.interpretedValue || slots.Time.value.originalValue,
        ":newEmail":
          slots.Email.value.interpretedValue || slots.Email.value.originalValue,
      },
      ExpressionAttributeNames: {
        "#loc": "Location",
        "#dt": "Date",
        "#tm": "Time",
        "#em": "Email",
      },
      ReturnValues: "ALL_NEW",
    };

    await dynamodb.send(new UpdateCommand(params));
  } catch (error) {
    console.error("Error updating preferences data in cache:", error);
  }
};

const checkConfirmationAndUpdateSlotData = async (slots, sessionId) => {
  if (slots.Confirmation && slots.Confirmation.value) {
    const userResponse =
      slots.Confirmation.value.interpretedValue.toLowerCase();
    if (userResponse === "yes" && !slots.Location && !slots.CuisineType) {
      // Continue with the cached data
      const cache = await queryDynamoDB(sessionId);

      // Use cached data to set slot values
      slots.Location = { value: { interpretedValue: cache.Location } };
      slots.CuisineType = { value: { interpretedValue: cache.CuisineType } };
      slots.NoOfPeople = { value: { interpretedValue: cache.NoOfPeople } };
      slots.Date = { value: { interpretedValue: cache.Date } };
      slots.Time = { value: { interpretedValue: cache.Time } };
      slots.Email = { value: { interpretedValue: cache.Email } };

      console.log("Updated slot values with cached data:", slots);
    }
  }
};

// Intent Handlers

function handleGreet(intentRequest) {
  return close(
    {},
    "Fulfilled",
    "Hi there, how can I help you?",
    intentRequest.sessionState.intent.name
  );
}

const handleDiningIntent = async (intentRequest) => {
  const slots = intentRequest.sessionState.intent.slots;
  const sessionAttributes = intentRequest.sessionState.sessionAttributes || {};
  const sessionId = intentRequest.sessionId;

  await checkConfirmationAndUpdateSlotData(slots, sessionId);

  // Validate inputs
  const validationResult = validateDining(slots);
  if (!validationResult.isValid) {
    slots[validationResult.violatedSlot] = null;

    if (validationResult.violatedSlot === "Location") {
      // Check if we have already got confirmation from the user
      if (!slots.Confirmation) {
        // Fetch cache from DynamoDB for the user
        const cache = await queryDynamoDB(sessionId);

        // Check if there is cached data
        if (cache.Location && cache.CuisineType) {
          // Prompt the user to continue with the previous search or start a new one
          return elicitSlot(
            sessionAttributes,
            intentRequest.sessionState.intent.name,
            slots,
            "Confirmation",
            `Would you like to continue with your previous search for '${
              cache.CuisineType
            }' cuisine in ${cache.Location}, for ${
              cache.NoOfPeople
            }, on ${formatDate(cache.Date)} at ${cache.Time}?`
          );
        }
      }
    }

    return elicitSlot(
      sessionAttributes,
      intentRequest.sessionState.intent.name,
      slots,
      validationResult.violatedSlot,
      validationResult.message.content
    );
  }

  if (!slots.Confirmation) {
    // Store the new search in DynamoDB
    await storeSearchInCache(slots, sessionId);
  } else {
    const userResponse =
      slots.Confirmation.value.interpretedValue.toLowerCase();

    if (userResponse === "no") {
      await updateCache(slots, sessionId);
    }
  }

  await sendMessageSQS(slots);

  return close(
    sessionAttributes,
    "Fulfilled",
    "Thanks, you're all set! You should receive suggestions soon.",
    intentRequest.sessionState.intent.name
  );
};

// Send Message to SQS
const sendMessageSQS = async (slots) => {
  try {
    const params = {
      QueueUrl: SQS_QUEUE_URL,
      MessageAttributes: {
        Location: {
          DataType: "String",
          StringValue:
            slots.Location.value.interpretedValue ||
            slots.Location.value.originalValue,
        },
        CuisineType: {
          DataType: "String",
          StringValue:
            slots.CuisineType.value.interpretedValue ||
            slots.CuisineType.value.originalValue,
        },
        NoOfPeople: {
          DataType: "Number",
          StringValue:
            slots.NoOfPeople.value.interpretedValue ||
            slots.NoOfPeople.value.originalValue,
        },
        Date: {
          DataType: "String",
          StringValue:
            slots.Date.value.interpretedValue || slots.Date.value.originalValue,
        },
        Time: {
          DataType: "String",
          StringValue:
            slots.Time.value.interpretedValue || slots.Time.value.originalValue,
        },
        Email: {
          DataType: "String",
          StringValue:
            slots.Email.value.interpretedValue ||
            slots.Email.value.originalValue,
        },
      },
      MessageBody: `Reservation request for ${slots.CuisineType.value.interpretedValue} in ${slots.Location.value.interpretedValue}`,
    };

    const sqsResult = await sqs.send(new SendMessageCommand(params));
    console.log("Message written to SQS:", sqsResult);
  } catch (err) {
    throw err;
  }
};

// Lambda Handler
export const handler = async (event) => {
  const intentName = event.sessionState.intent.name;

  if (intentName === "GreetingIntent") {
    return handleGreet(event);
  } else if (intentName === "DiningSuggestionsIntent") {
    const response = await handleDiningIntent(event);
    return response;
  } else {
    throw new Error(`Intent ${intentName} not supported`);
  }
};
