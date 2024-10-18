/* 
Get 50 restaurants in Manhattan for each cuisine type from Yelp API and store them in DynamoDB 
*/

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import axios from "/opt/nodejs/node_modules/axios/index.js"; // add axios layer to lambda for this import to work

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const tableName = "yelp-restaurants";
const YELP_API_KEY = process.env.YELP_API_KEY;
const numberOfRestaurantsByCuisine = 50;

// Helper function to structure restaurant data for DynamoDB
const createDynamoEntry = (restaurant, cuisine) => ({
  id: restaurant.id,
  Name: restaurant.name,
  Address: restaurant.location.address1 || "",
  Coordinates: restaurant.coordinates,
  NumberOfReviews: restaurant.review_count,
  Rating: restaurant.rating,
  ZipCode: restaurant.location.zip_code || "",
  Cuisine: cuisine,
  insertedAtTimestamp: new Date().toISOString(),
});

// Yelp API Call Function
const fetchRestaurantsFromYelp = async (cuisine, location, offset) => {
  const url = `https://api.yelp.com/v3/businesses/search?location=${location}&term=${cuisine}&limit=50&offset=${offset}`;
  const headers = {
    Authorization: `Bearer ${YELP_API_KEY}`,
  };
  try {
    const response = await axios.get(url, { headers });
    console.log(response.data.businesses);
    return response.data.businesses || [];
  } catch (error) {
    console.error("Error fetching data from Yelp API:", error);
    throw error;
  }
};

// Function to store a restaurant in DynamoDB if it doesn't already exist
const storeRestaurantInDynamoDB = async (restaurant, cuisine) => {
  const params = {
    TableName: tableName,
    Item: createDynamoEntry(restaurant, cuisine),
    ConditionExpression: "attribute_not_exists(id)", // Only insert if the restaurant does not exist already in dynamodb
  };

  try {
    await dynamo.send(new PutCommand(params));
    return true; // Successfully added a new restaurant
  } catch (error) {
    console.log(`Duplicate entry: ${restaurant.name} already exists.`);
    return false; // Duplicate entry
  }
};

// Function to fetch and store restaurants, skipping duplicates
const fetchAndStoreRestaurants = async (cuisine, location = "Manhattan") => {
  let offset = 0;
  let totalFetched = 0;
  let uniqueRestaurants = 0;

  while (uniqueRestaurants < numberOfRestaurantsByCuisine) {
    const restaurants = await fetchRestaurantsFromYelp(
      cuisine,
      location,
      offset
    );

    if (restaurants.length === 0) break;
    for (const restaurant of restaurants) {
      const isNew = await storeRestaurantInDynamoDB(restaurant, cuisine);
      if (isNew) {
        uniqueRestaurants++;
      }

      // Stop if we've already fetched the required number of unique restaurants
      if (uniqueRestaurants >= numberOfRestaurantsByCuisine) break;
    }

    totalFetched += restaurants.length;
    offset += 50;

    // Respect Yelp API rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

//Lambda Handler
export const handler = async (event, context) => {
  const cuisines = ["Chinese", "Indian", "Italian", "Mexican", "Japanese"];

  try {
    for (const cuisine of cuisines) {
      console.log(`Fetching data for ${cuisine} restaurants in Manhattan...`);
      await fetchAndStoreRestaurants(cuisine);
    }

    return {
      statusCode: 200,
      body: JSON.stringify("Successfully fetched and stored restaurants!"),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify(
        "Error fetching and storing restaurants: " + error.message
      ),
    };
  }
};
