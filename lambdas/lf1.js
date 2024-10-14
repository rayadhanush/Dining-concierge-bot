import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
const sqs = new SQSClient();
const queueUrl = "https://sqs.us-east-1.amazonaws.com/445567085379/Q1";

// --- Helpers that build all of the responses ---

function elicitSlot(
  sessionAttributes,
  intentName,
  slots,
  slotToElicit,
  message
) {
  return {
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
  };
}

function close(sessionAttributes, fulfillmentState, message, intentName) {
  return {
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
  };
}

function delegate(sessionAttributes, slots, intentName) {
  return {
    sessionState: {
      sessionAttributes: sessionAttributes,
      intent: {
        name: intentName,
        slots: slots,
        state: "ReadyForFulfillment",
      },
      dialogAction: {
        type: "Delegate",
      },
    },
  };
}

// --- Helper Functions ---
function safeInt(n) {
  return n ? parseInt(n) : null;
}

function tryEx(func) {
  try {
    return func();
  } catch (err) {
    return null;
  }
}

function isValidDate(date) {
  return !isNaN(Date.parse(date));
}

function buildValidationResult(isValid, violatedSlot, messageContent) {
  return {
    isValid: isValid,
    violatedSlot: violatedSlot,
    message: {
      contentType: "PlainText",
      content: messageContent,
    },
  };
}

// --- Validation Functions ---

function isValidCity(city) {
  const validCities = [
    "new york",
    "los angeles",
    "chicago",
    "houston",
    "philadelphia",
    "nyc",
    "manhattan",
  ];
  return validCities.includes(city.toLowerCase());
}

function isValidCuisine(cuisine) {
  const validCuisines = [
    "vegetarian",
    "seafood",
    "indian",
    "chinese",
    "italian",
  ];
  return validCuisines.includes(cuisine.toLowerCase());
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateDining(slots) {
  const location = tryEx(
    () =>
      slots.Location.value.interpretedValue ||
      slots.Location.value.originalValue
  );
  const cuisine = tryEx(
    () =>
      slots.CuisineType.value.interpretedValue ||
      slots.CuisineType.value.originalValue
  );
  const count = safeInt(
    tryEx(
      () =>
        slots.NoOfPeople.value.interpretedValue ||
        slots.NoOfPeople.value.originalValue
    )
  );
  const date = tryEx(
    () => slots.Date.value.interpretedValue || slots.Date.value.originalValue
  );
  const time = tryEx(
    () => slots.Time.value.interpretedValue || slots.Time.value.originalValue
  );
  const email = tryEx(
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
      "You can make a reservation for 1 to 8 guests. How many guests?"
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

// --- Intent Handlers ---

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

  const validationResult = validateDining(slots);
  if (!validationResult.isValid) {
    slots[validationResult.violatedSlot] = null;
    return elicitSlot(
      sessionAttributes,
      intentRequest.sessionState.intent.name,
      slots,
      validationResult.violatedSlot,
      validationResult.message.content
    );
  }

  await sendMessage(slots);
  return close(
    sessionAttributes,
    "Fulfilled",
    "Thanks, you're all set! You should receive suggestions soon.",
    intentRequest.sessionState.intent.name
  );
};

// --- Send Message to SQS ---

const sendMessage = async (slots) => {
  try {
    const params = {
      QueueUrl: queueUrl,
      MessageAttributes: {
        Location: {
          DataType: "String",
          StringValue: slots.Location.value.interpretedValue,
        },
        CuisineType: {
          DataType: "String",
          StringValue: slots.CuisineType.value.interpretedValue,
        },
        NoOfPeople: {
          DataType: "Number",
          StringValue: slots.NoOfPeople.value.interpretedValue,
        },
        Date: {
          DataType: "String",
          StringValue: slots.Date.value.interpretedValue,
        },
        Time: {
          DataType: "String",
          StringValue: slots.Time.value.interpretedValue,
        },
        Email: {
          DataType: "String",
          StringValue: slots.Email.value.interpretedValue,
        },
      },
      MessageBody: `Reservation request for ${slots.CuisineType.value.interpretedValue} in ${slots.Location.value.interpretedValue}`,
    };

    const sqsResult = await sqs.send(new SendMessageCommand(params));
    console.log(sqsResult);
  } catch (err) {
    throw err;
  }
};

// --- Main Handler ---

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
