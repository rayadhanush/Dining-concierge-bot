/*
 * Read data stored in Dynamodb and ingest it in Opensearch
 * Add the Lambda ARN as an user to Opensearch all_access policy to execute this script as a Lambda function
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { defaultProvider } from "@aws-sdk/credential-provider-node"; // V3 SDK
import { Client } from "@opensearch-project/opensearch"; // add opensearch layer to lambda
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";

const dynamoClient = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const tableName = "yelp-restaurants";
const INDEX = "restaurants";

const ES_ENDPOINT = process.env.ES_ENDPOINT; // AWS Opensearch domain url

// Function to insert data into OpenSearch
const insertToOpenSearch = async (client, restaurant) => {
  const document = {
    Cuisine: restaurant.Cuisine,
  };

  try {
    await client.index({
      id: restaurant.id,
      index: INDEX,
      body: document,
      refresh: true,
    });

    console.log(`Successfully inserted: ${restaurant.id}`);
  } catch (error) {
    console.error(`Error inserting ${restaurant.id}:`, error);
  }
};

// Lambda Handler
export const handler = async (event, context) => {
  let body;
  let statusCode = 200;

  try {
    // Fetch restaurants from dynamoDB
    body = await dynamo.send(new ScanCommand({ TableName: tableName }));
    body = body.Items;

    //Initialize client to communicate with Opensearch
    const osClient = new Client({
      ...AwsSigv4Signer({
        region: "us-east-1",
        service: "es",
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: ES_ENDPOINT,
    });

    // create index in opensearch
    await osClient.indices.create({
      index: INDEX,
      body: {
        settings: {
          index: {
            number_of_shards: 1,
          },
        },
      },
    });

    for (const restaurant of body) {
      await insertToOpenSearch(osClient, restaurant);
    }
  } catch (err) {
    statusCode = 400;
    body = err.message;
  } finally {
    body = JSON.stringify(body);
  }

  return {
    statusCode,
    body,
  };
};
