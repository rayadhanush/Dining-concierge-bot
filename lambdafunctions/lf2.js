import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { defaultProvider } from "@aws-sdk/credential-provider-node"; // V3 SDK
import { Client } from "@opensearch-project/opensearch"; // add opensearch layer to lambda
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sqs = new SQSClient();

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

const ses = new SESClient({});

const TABLE_NAME = "yelp-restaurants";
const INDEX = "restaurants";
const REGION = "us-east-1";
const NUMBER_OF_RESTAURANTS = 3; // Number of restaurants to suggest to user

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const ES_ENDPOINT = process.env.ES_ENDPOINT; // AWS Opensearch domain url
const SOURCE_EMAIL = process.env.SOURCE_EMAIL; // email address from which you want to send suggestions

// Helper function
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

// Poll messages from SQS
const pollSQS = async () => {
  const params = {
    QueueUrl: SQS_QUEUE_URL,
    MaxNumberOfMessages: 5,
    WaitTimeSeconds: 20,
    MessageAttributeNames: ["All"],
  };

  try {
    const data = await sqs.send(new ReceiveMessageCommand(params));
    return data.Messages || [];
  } catch (error) {
    console.error("Error polling SQS:", error);
    return [];
  }
};

// Query OpenSearch for N random restaurants matching cuisine requested by user
const queryOS = async (client, cuisine) => {
  const query = {
    size: NUMBER_OF_RESTAURANTS,
    query: {
      function_score: {
        query: {
          match: {
            Cuisine: {
              query: cuisine,
            },
          },
        },
        functions: [
          {
            random_score: {},
          },
        ],
      },
    },
  };

  try {
    const response = await client.search({
      index: INDEX,
      body: query,
    });

    return response;
  } catch (error) {
    console.error(
      `Error retrieving restaurants of cuisine type ${cuisine} from OpenSearch:`,
      error
    );
    return null;
  }
};

const handleOSResponse = async (response, attributes) => {
  const hitsObj = response.hits;
  const hitCount = hitsObj.hits.length;

  if (hitCount === 0) {
    console.error("No hits retrieved from Opensearch");
    await sendError(attributes);
  } else {
    const suggestions = [];

    for (const hit of hitsObj.hits) {
      const restaurantId = hit._id;
      const suggestion = await queryDynamoDB(restaurantId);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    if (suggestions.length > 0) {
      await sendMessage(suggestions, attributes);
    } else {
      await sendError(attributes);
    }
  }
};

// Query DynamoDB using restaurant ID from OpenSearch
const queryDynamoDB = async (restaurantId) => {
  const params = {
    TableName: TABLE_NAME,
    Key: { id: restaurantId },
  };

  try {
    const result = await dynamodb.send(new GetCommand(params));
    return result.Item;
  } catch (err) {
    console.error(
      `Error retrieving restaurant with id \'${restaurantId}\' from DynamoDB:`,
      err
    );
    return null;
  }
};

// Send email with restaurant suggestions
const sendMessage = async (restaurants, attributes) => {
  // Get attribute details
  const date = formatDate(attributes.Date.StringValue);
  const email = attributes.Email.StringValue;
  const count = attributes.NoOfPeople.StringValue;
  const time = attributes.Time.StringValue;

  // Construct message for multiple restaurants
  let message = `Hello! Here are my restaurant suggestions for ${count} people on ${date} at ${time}:\n\n`;

  restaurants.forEach((restaurant, index) => {
    const restName = restaurant.Name;
    const cuisine = restaurant.Cuisine;
    const location = restaurant.Address;
    message += `${
      index + 1
    }. ${restName} (${cuisine}), located at ${location}\n`;
  });

  message += "\nEnjoy your dining experience!";

  const params = {
    Destination: { ToAddresses: [email] },
    Message: {
      Body: { Text: { Charset: "UTF-8", Data: message } },
      Subject: {
        Charset: "UTF-8",
        Data: "Dining Concierge - Restaurant Suggestions",
      },
    },
    Source: SOURCE_EMAIL,
  };

  try {
    await ses.send(new SendEmailCommand(params));
    console.log("Email sent successfully");
  } catch (err) {
    console.error("Error sending email:", err);
  }
};

// Send error message via SES
const sendError = async (attributes) => {
  // Get attribute details
  const date = formatDate(attributes.Date.StringValue);
  const email = attributes.Email.StringValue;
  const count = attributes.NoOfPeople.StringValue;
  const time = attributes.Time.StringValue;
  const cuisine = attributes.CuisineType.StringValue;
  const location = attributes.Location.StringValue;

  // Draft message
  const message = `Unfortunately, no ${cuisine} restaurants found in ${location} for ${count} people on ${date} at ${time}. Please try again later.`;

  const params = {
    Destination: { ToAddresses: [email] },
    Message: {
      Body: { Text: { Charset: "UTF-8", Data: message } },
      Subject: {
        Charset: "UTF-8",
        Data: "Dining Concierge - No Suggestions Found",
      },
    },
    Source: SOURCE_EMAIL,
  };

  try {
    await ses.send(new SendEmailCommand(params));

    console.log("Error message sent to email");
  } catch (err) {
    console.error("Error sending error message to email:", err);
  }
};

// Delete message from SQS
const deleteSQSMessage = async (message) => {
  try {
    const deleteParams = {
      QueueUrl: SQS_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    };

    await sqs.send(new DeleteMessageCommand(deleteParams));

    console.log(
      "Deleted message successfully from SQS:",
      message.ReceiptHandle
    );
  } catch (error) {
    console.error("Error deleting message from SQS:", error);
  }
};

// Lambda handler to process SQS messages
export const handler = async (event) => {
  const messages = await pollSQS();

  if (messages.length === 0) {
    console.log("No SQS messages to process.");
    return;
  }

  //Initialize client to communicate with Opensearch
  const osClient = new Client({
    ...AwsSigv4Signer({
      region: REGION,
      service: "es",
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: ES_ENDPOINT,
  });

  for (const message of messages) {
    const attributes = message.MessageAttributes;
    const cuisine = attributes.CuisineType.StringValue;

    console.log("Processing SQS message:", message);

    try {
      const osResponse = await queryOS(osClient, cuisine);

      await handleOSResponse(osResponse.body, attributes);
    } catch (err) {
      console.error("Error querying OpenSearch:", err);
      await sendError(attributes);
    }

    // Remove the processed message from SQS
    await deleteSQSMessage(message);
  }
};
