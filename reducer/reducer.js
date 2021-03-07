// Combine all county data sets into a central data.json dataset

const AWS = require("aws-sdk");
const zlib = require("zlib");
const s3 = new AWS.S3();

const getObject = async (key, bucket) => {
  try {
    const file = await s3
      .getObject({
        Bucket: bucket,
        Key: key,
        ResponseContentType: "application/json",
      })
      .promise();

    const unzippedFile = zlib.gunzipSync(new Buffer.from(file.Body)).toString();

    return JSON.parse(unzippedFile);
  } catch (error) {
    console.log("Error getting object: ", error);
  }
};

const listObjects = async (prefix, bucketName) => {
  try {
    const response = await s3
      .listObjectsV2({
        Bucket: bucketName,
        MaxKeys: 100,
        Prefix: prefix,
      })
      .promise();

    console.log(`Found ${response.Contents.length - 1} counties to process.`);
    return response.Contents.filter((obj) => obj.Key !== prefix);
  } catch (error) {
    console.log("Error listing objects: ", error);
  }
};

// process is:
//    - list every key within the key `bucketName/counties` in bucket `event.sourceBucket`
//    - read the json file (each key) and take all the first JSON object key from the file (the county name) and add it to a central {}
//    - write the central {} data to data.json in root bucket and upload to s3
exports.handler = async (event, context, callback) => {
  const counties = await listObjects(
    event.sourceBucketPrefix,
    event.sourceBucket
  );

  // Iterate through all objects within the `/county` prefix
  const allCountiesData = await Promise.all(
    counties.map(async (obj) => {
      const filename = obj.Key;
      console.log(`Processing ${filename} county file.`);

      return await getObject(filename, event.sourceBucket);
    })
  );

  // Main data structure with all counties as the keys
  const finalCollection = allCountiesData.reduce((memo, obj) => {
    // Assumption is that all county data files have one key which is the county name
    if (obj && Object.keys(obj).length > 0) {
      const countyName = Object.keys(obj)[0];
      memo[countyName] = obj[countyName];
    }
    return memo;
  }, {});

  const buffer = Buffer.from(JSON.stringify(finalCollection), "utf-8");
  const compressedData = zlib.gzipSync(buffer, (err, response) => {
    if (err) {
      console.log(err);
    } else {
      return response;
    }
  });

  // Upload consolidated dataset to S3
  try {
    const destinationParams = {
      Bucket: event.destinationBucket,
      Key: "data.json",
      Body: compressedData,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "max-age=600",
      ContentEncoding: "gzip",
    };

    await s3.putObject(destinationParams).promise();
    console.log("Finished upload results to S3");
    callback(null, {
      statusCode: 200,
      body: `Successfully uploaded consolidated update to ${event.destinationBucket}/data.json`,
    });
  } catch (error) {
    console.log(error);
    callback(null, {
      statusCode: 500,
      body: "ERROR",
    });
  }
};
