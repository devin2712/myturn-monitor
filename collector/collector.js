const AWS = require("aws-sdk");
const axios = require("axios");
const s3 = new AWS.S3();

// Logging how many API calls we are making outbound to MyTurn for info.
let MYTURN_API_COUNT = 0;

// Selected lat/long of county geo location to search for location availabilities.
const COUNTY_LAT_LONG = {
  Alameda: [37.7652076, -122.2416355],
  Alpine: [32.846668, -116.807269],
  Amador: [38.4193553, -120.824103],
  Berkeley: [37.8708393, -122.2728639],
  Butte: [39.72949775, -121.8481053],
  Calaveras: [38.2638071, -120.2785402],
  Colusa: [39.1465578, -122.2209563],
  "Contra Costa": [37.9034806, -121.9175345],
  "Del Norte": [41.7261767, -123.91328],
  "El Dorado": [38.6826817, -120.8477146],
  Fresno: [36.7295295, -119.7088613],
  Glenn: [39.5218283, -122.0138651],
  Humboldt: [40.87558755, -124.0779998],
  Imperial: [32.8475529, -115.5694391],
  Inyo: [36.7349318, -117.9856422],
  Kern: [35.3821806, -118.9826001],
  Kings: [36.3826384, -119.861114],
  Lake: [39.0505411, -122.7776556],
  Lassen: [40.49138385, -121.4043359],
  "Long Beach": [33.7817687, -118.1151997],
  "Los Angeles": [34.0536909, -118.242766],
  Madera: [36.9418115, -120.1714382],
  Marin: [37.99800515, -122.5306406],
  Mariposa: [37.48218185, -119.9639587],
  Mendocino: [39.3076744, -123.7994591],
  Merced: [37.3029568, -120.4843269],
  Modoc: [41.5450487, -120.7435998],
  Mono: [37.9533927, -118.9398758],
  Monterey: [36.2231079, -121.3877428],
  Napa: [38.2971367, -122.2855293],
  Nevada: [40.659622, -118.14932],
  Orange: [33.7500378, -117.8704931],
  Pasadena: [34.1430079, -118.1417617],
  Placer: [39.009344, -120.7707639],
  Plumas: [39.7568786, -120.7047562],
  Riverside: [33.7219991, -116.0372472],
  Sacramento: [38.5810606, -121.4938951],
  "San Benito": [36.5096854, -121.0818602],
  "San Bernardino": [34.1083449, -117.2897652],
  "San Diego": [32.7174202, -117.1627728],
  "San Francisco": [37.7790262, -122.4199061],
  "San Joaquin": [37.9372901, -121.2773719],
  "San Luis Obispo": [35.2827525, -120.6596156],
  "San Mateo": [37.5439684, -122.3066789],
  "Santa Barbara": [34.7136533, -119.9858232],
  "Santa Clara": [37.3541132, -121.9551744],
  "Santa Cruz": [37.050096, -121.9905908],
  Shasta: [40.5993165, -122.4919571],
  Sierra: [-17.8219718, -63.2174815],
  Siskiyou: [41.66722485, -123.7106152],
  Solano: [38.2358384, -122.1011537],
  Sonoma: [38.5110803, -122.8473388],
  Stanislaus: [37.5500871, -121.0501425],
  Sutter: [38.9509675, -121.697088],
  Tehama: [40.0271015, -122.1233228],
  Trinity: [40.8544797, -123.0408066],
  Tulare: [36.2077351, -119.3473421],
  Tuolumne: [37.961335, -120.2389796],
  Ventura: [34.3435092, -119.2956042],
  Yolo: [38.7318481, -121.8077431],
  Yuba: [39.1254479, -121.5855207],
};

/**
 *  Our goal is to just get a valid vaccineData response that we'll reuse to
 *  collect locations status data across all counties and locations under MyTurn.
 *
 *  Return null if no vaccineData found [and skip collection]
 */
const fetchVaccineData = async () => {
  const data = {
    eligibilityQuestionResponse: [
      {
        id: "q.screening.18.yr.of.age",
        value: ["q.screening.18.yr.of.age"],
        type: "multi-select",
      },
      {
        id: "q.screening.health.data",
        value: ["q.screening.health.data"],
        type: "multi-select",
      },
      {
        id: "q.screening.privacy.statement",
        value: ["q.screening.privacy.statement"],
        type: "multi-select",
      },
      {
        id: "q.screening.eligibility.age.range",
        value: "75 and older",
        type: "single-select",
      },
      {
        id: "q.screening.eligibility.industry",
        value: "Other",
        type: "single-select",
      },
      {
        id: "q.screening.eligibility.county",
        value: "Alameda",
        type: "single-select",
      },
      {
        id: "q.screening.accessibility.code",
        type: "text",
      },
    ],
    url: "https://myturn.ca.gov/screening",
  };

  try {
    const response = await axios({
      method: "post",
      url: "https://api.myturn.ca.gov/public/eligibility",
      headers: {
        "Content-Type": "application/json",
      },
      data: data,
    });

    // Error response from MyTurn, skip this job.
    if (response.status !== 200) {
      return null;
    }
    MYTURN_API_COUNT++;

    // If the user is eligible, MyTurn will respond with a "hashed" vaccineData string
    //  that will be used in subsequent responses to identify the user eligibility profile.
    if (
      response.data.eligible &&
      response.data.vaccineData &&
      response.data.vaccineData.length > 0
    ) {
      return response.data.vaccineData;
    } else {
      return null;
    }
  } catch (error) {
    console.log(error);
    return null;
  }
};

/**
 *
 * @param {Date} todayDate runtime timestamp
 * @param {String} county The name of the county within which to search for available locations
 * @param {String} vaccineData "hashed" string from MyTurn to identify vaccine eligibility
 *
 * @returns {Array} All available locations for the county. Empty if no locations have availabilities.
 */
const myTurnLocationSearch = async (todayDate, county, vaccineData) => {
  const locationData = {
    location: {
      lat: COUNTY_LAT_LONG[county][0],
      lng: COUNTY_LAT_LONG[county][1],
    },
    fromDate: todayDate.toISOString().slice(0, 10),
    vaccineData: vaccineData,
    locationQuery: {
      includePools: ["default"],
    },
    url: "https://myturn.ca.gov/location-select",
  };

  try {
    const response = await axios({
      method: "post",
      url: "https://api.myturn.ca.gov/public/locations/search",
      headers: {
        "Content-Type": "application/json",
      },
      data: locationData,
    });

    // Error from MyTurn: Skip this county!
    if (response.status !== 200) {
      return null;
    }
    MYTURN_API_COUNT++;

    if (response.data.locations && response.data.locations.length > 0) {
      return response.data.locations.map((locationInfo) => ({
        id: locationInfo.extId,
        address: locationInfo.displayAddress,
        lat: locationInfo.location.lat,
        long: locationInfo.location.lng,
        name: locationInfo.name,
        hours: locationInfo.openHours,
        type: locationInfo.type,
        timezone: locationInfo.timezone,
        vaccineData: locationInfo.vaccineData,
        externalURL: locationInfo.externalURL,
      }));
    } else {
      return [];
    }
  } catch (error) {
    console.log(error);
    return [];
  }
};

/**
 *
 * @param {String} locationId locationExtId MyTurn unique location ID
 * @param {String} dateString date to search for available slots (format: "2021-01-01")
 * @param {Number} doseNumber dose number to use when querying available time slots
 * @param {String} vaccineData "hashed" string from MyTurn to identify vaccine eligibility
 */
const myTurnSlotAvailabilityCheck = async (
  locationId,
  dateString,
  doseNumber,
  vaccineData
) => {
  const response = await axios({
    method: "post",
    url: `https://api.myturn.ca.gov/public/locations/${locationId}/date/${dateString}/slots`,
    headers: {
      "Content-Type": "application/json",
    },
    data: {
      vaccineData: vaccineData,
      dose: doseNumber,
    },
  });
  MYTURN_API_COUNT++;

  return response.data.slotsWithAvailability;
};

/**
 *
 * @param {Date} normalizedFirstDoseDate first available dose date
 * @param {String} locationId locationExtId MyTurn unique location ID
 * @param {String} timezone IANA time zone of the location
 * @param {Array} dose1Availabilities Array of available dates
 * @param {String} vaccineData "hashed" string from MyTurn to identify vaccine eligibility
 *
 * Fetch the time slots for the first available dose 1 date. If slots array is empty, there aren't actually availabilities.
 * Ensure that the last item in the slots array (in format "15:00:00") is after the current time.
 *
 */
const revisedDose1Availabilities = async (
  normalizedFirstDoseDate,
  locationId,
  timezone,
  dose1Availabilities,
  vaccineData
) => {
  // Format date to YYYYY-MM-DD - current date in location timezone
  const todayDate = new Date();

  // Need to get current date in the vaccine location's timezone and manually format to YYYY-MM-DD (which isn't
  //  guaranteed to be the locale's format for dates).
  const todayDateYear = todayDate.toLocaleString("en-US", {
    year: "numeric",
    timeZone: timezone,
  });
  const todayDateMonth = todayDate.toLocaleString("en-US", {
    month: "2-digit",
    timeZone: timezone,
  });
  const todayDateDay = todayDate.toLocaleString("en-US", {
    day: "2-digit",
    timeZone: timezone,
  });
  const todayDateString = `${todayDateYear}-${todayDateMonth}-${todayDateDay}`;

  // Format date to YYYY-MM-DD
  const firstDoseDate = normalizedFirstDoseDate.toISOString().slice(0, 10);

  // if first available dose date is not the current date then ignore
  if (firstDoseDate === todayDateString) {
    // Get the current time in the vaccine location's timezone in format "15:00:00"
    const currentTime = todayDate.toLocaleString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: timezone,
    });

    const availableTimeSlots = await myTurnSlotAvailabilityCheck(
      locationId,
      normalizedFirstDoseDate,
      1,
      vaccineData
    );

    const firstDoseDateString = normalizedFirstDoseDate
      .toISOString()
      .slice(0, 10);
    // Unexpected, but if there are no time slots available then this date was marked as available in error.
    // Return the results without today's date
    if (availableTimeSlots.length === 0) {
      console.log(
        `Removing first dose date ${firstDoseDateString} for ${locationId} due to no slot availability on this day.`
      );
      return dose1Availabilities.filter((a) => a.date !== firstDoseDateString);
    } else {
      const lastSlotTime =
        availableTimeSlots[availableTimeSlots.length - 1].localStartTime;
      console.log(
        `Found last slot time: ${lastSlotTime} - comparing to ${currentTime} local time.`
      );
      return lastSlotTime > currentTime
        ? dose1Availabilities
        : dose1Availabilities.filter((a) => a.date !== firstDoseDateString);
    }
  } else {
    return dose1Availabilities;
  }
};

/**
 *
 * @param {Date} todayDate runtime timestamp
 * @param {String} locationVaccineData "hashed" string from MyTurn to identify vaccine eligibility
 * @param {String} locationId locationExtId from MyTurn to uniquely identify a vaccination site
 * @param {String} locationTimeZone timezone for location
 * @param {Number} numOfDaysBetweenDoses number of days in between doses is used to space apart the search for second dose date availability
 */
const myTurnAvailabilityCheckForLocation = async (
  locationVaccineData,
  locationId,
  locationTimeZone,
  numOfDaysBetweenDoses
) => {
  const checkData = (date, doseNumber) => {
    // We are searching from the provided `date` to two months ahead
    let twoMonthOutlook = new Date(date);
    twoMonthOutlook.setMonth(twoMonthOutlook.getMonth() + 2);

    return {
      vaccineData: locationVaccineData,
      startDate: date.toISOString().slice(0, 10),
      endDate: twoMonthOutlook.toISOString().slice(0, 10),
      doseNumber: doseNumber,
      url: "https://myturn.ca.gov/appointment-select",
    };
  };

  try {
    // CA MyTurn will attempt to book both dose appointments during the registration process.
    // We should only send a notification that it's possible to book in the system if there are availabilities:
    //    1) From today onwards for dose 1
    //    2) From <the first available first dose date> + 21 days onwards
    //
    // If there are only availabilities for the first dose but you can't book the second dose, then don't send notification.
    const dose1Response = await axios({
      method: "post",
      url: `https://api.myturn.ca.gov/public/locations/${locationId}/availability`,
      headers: {
        "Content-Type": "application/json",
      },
      data: checkData(new Date(), 1),
    });
    MYTURN_API_COUNT++;

    const dose1Availabilities = dose1Response.data.availability.filter(
      (a) => a.available
    );

    // Break out early if no availability for dose 1
    if (dose1Availabilities.length === 0) {
      console.log("No availabilities for dose 1. Skipping.");
      return {
        dose1Availabilities: [],
        dose2Availabilities: [],
      };
    }

    // Let's assume the Pfizer use case with 21 days.
    // Assume that the seed date is the min date from the dose 1 response
    const firstAvailableFirstDoseDate = new Date(dose1Availabilities[0].date);

    // Offset JS date timezone issue to ensure the DAY is correct
    // When we instantiate a new date from a string like: new Date("2020-01-01"), the date will depend on the
    //  local timezone and if it's not GMT the *day* may be incorrect because the local server is behind or ahead of GMT day
    const normalizedFirstDoseDate = new Date(
      firstAvailableFirstDoseDate.getTime() -
        firstAvailableFirstDoseDate.getTimezoneOffset() * -60000
    );

    // We need to double check MyTurn API response for an edge case. Sometimes they will provide availability for
    // today's date but all the open slots have already passed. We need to make one additional API call to look up
    // the actual available time slots for today's date and if the last time slot is after the current time,
    // then it is a valid day. Otherwise, remove the date from the array.
    const actualDose1Availabilities = await revisedDose1Availabilities(
      normalizedFirstDoseDate,
      locationId,
      locationTimeZone,
      dose1Availabilities,
      locationVaccineData
    );

    if (actualDose1Availabilities.length === 0) {
      console.log(
        "No availabilities for dose 1 after removing today's date. Skipping."
      );
      return {
        dose1Availabilities: [],
        dose2Availabilities: [],
      };
    }

    // Remove this if performance becomes an issue.
    const dose1AvailabilitiesWithSlots = await Promise.all(
      actualDose1Availabilities.map(async (availability) => {
        const slotAvailabilities = await myTurnSlotAvailabilityCheck(
          locationId,
          availability.date,
          1,
          locationVaccineData
        );
        console.log(
          `Found ${slotAvailabilities.length} available slots for dose 1 on ${availability.date}`
        );
        return {
          date: availability.date,
          slots: slotAvailabilities,
        };
      })
    );

    // We need to find the first date from dose 1 availabilities that has slots and use that
    // as the initial start date from which to search for second doses.
    const dose1AvailabilitiesWithAvailableSlots = dose1AvailabilitiesWithSlots.filter(
      (date) => date["slots"] && date["slots"].length > 0
    );

    // If there are no actual dose 1 dates with slots, we need to return and cancel.
    if (dose1AvailabilitiesWithAvailableSlots.length === 0) {
      return {
        dose1Availabilities: [],
        dose2Availabilities: [],
      };
    }
    const firstActualDose1Date = new Date(
      dose1AvailabilitiesWithAvailableSlots[0].date
    );
    const normalizedFirstActualDose1Date = new Date(
      firstActualDose1Date.getTime() -
        firstActualDose1Date.getTimezoneOffset() * -60000
    );
    // Add the number of days in between doses to the first-available first-dose appointment date.
    let secondDoseStartDate = new Date(normalizedFirstActualDose1Date);
    secondDoseStartDate.setDate(
      secondDoseStartDate.getDate() + Number(numOfDaysBetweenDoses)
    );

    console.log(
      `Found ${
        actualDose1Availabilities.length
      } dose 1 availabilities. Checking dose 2 starting at ${secondDoseStartDate
        .toISOString()
        .slice(
          0,
          10
        )} [${numOfDaysBetweenDoses} days from ${normalizedFirstActualDose1Date
        .toISOString()
        .slice(0, 10)}]`
    );

    const dose2Response = await axios({
      method: "post",
      url: `https://api.myturn.ca.gov/public/locations/${locationId}/availability`,
      headers: {
        "Content-Type": "application/json",
      },
      data: checkData(secondDoseStartDate, 2),
    });
    MYTURN_API_COUNT++;

    const dose2Availabilities = dose2Response.data.availability.filter(
      (a) => a.available
    );

    // Remove this if performance becomes an issue.
    const dose2AvailabilitiesWithSlots = await Promise.all(
      dose2Availabilities.map(async (availability) => {
        const slotAvailabilities = await myTurnSlotAvailabilityCheck(
          locationId,
          availability.date,
          2,
          locationVaccineData
        );
        console.log(
          `Found ${slotAvailabilities.length} available slots for dose 2 on ${availability.date}`
        );
        return {
          date: availability.date,
          slots: slotAvailabilities,
        };
      })
    );

    return {
      dose1Availabilities: dose1AvailabilitiesWithSlots,
      dose2Availabilities: dose2AvailabilitiesWithSlots,
    };
  } catch (error) {
    console.log(error);
    return {
      dose1Availabilities: [],
      dose2Availabilities: [],
    };
  }
};

const getCountyData = async (todayDate, countyName, vaccineData) => {
  console.log(`Processing COUNTY: ${countyName}`);
  const locations = await myTurnLocationSearch(
    todayDate,
    countyName,
    vaccineData
  );

  // Error from MyTurn: skip this county
  if (locations === null) {
    return null;
  }

  console.log(`Found ${locations.length} locations for ${countyName}`);

  const locationsWithAvailability = await Promise.all(
    locations.map(async (location) => {
      console.log(`Processing ${location.id} ${location.name}`);

      // If it's an external vaccination site, we won't know how many available slots there are,
      //  so just pass along the location info with the external URL.
      if (location.type && location.type === "ThirdPartyBooking") {
        return {
          ...location,
          availability: {
            dose1Availabilities: [],
            dose2Availabilities: [],
          },
          hasAvailabilities: null,
          notes: "Unable to fetch availabilities. Visit external provider website for more information."
        };
      }

      // Cheap check for Moderna which is 28
      const numOfDays = location.name.toLowerCase().includes("moderna")
        ? 28
        : 21;
      const availabilityForLocation = await myTurnAvailabilityCheckForLocation(
        location.vaccineData,
        location.id,
        location.timezone,
        numOfDays
      );

      return {
        ...location,
        availability: availabilityForLocation,
        hasAvailabilities:
          availabilityForLocation.dose1Availabilities.length > 0 &&
          availabilityForLocation.dose2Availabilities.length > 0,
      };
    })
  );

  return {
    data_collection_time: new Date().toISOString(),
    locations: locationsWithAvailability,
  };
};

exports.handler = async (event, context, callback) => {
  try {
    const todayDate = new Date();
    const vaccineData = await fetchVaccineData();

    if (vaccineData === null) {
      console.log(`Skipping collection due to empty vaccineData.`);
      callback(null, {
        statusCode: 422,
        body: "Skipping collection due to empty vaccineData.",
      });
    }

    console.log(
      `Starting collection for ${todayDate} with vaccineData ${vaccineData}`
    );

    const collectCounties = event.counties.map(async (countyName) => {
      const countyData = await getCountyData(
        todayDate,
        countyName,
        vaccineData
      );

      // Received error status from MyTurn: skip this county
      if (countyData === null) {
        console.log(
          `ERROR: Got an error status from MyTurn for ${countyName}; skipping and not updating county file.`
        );
        return Promise.resolve();
      }

      const countyFile = { [countyName]: countyData };
      // Remove spaces for filename. "Los Angeles" => "losangeles.json"
      const countyFilename =
        countyName.toLowerCase().replace(/\s+/g, "") + ".json";

      // Upload county-specific data to /counties s3 bucket
      try {
        const destinationParams = {
          Bucket: event.destinationBucket,
          Key: `counties/${countyFilename}`,
          Body: JSON.stringify(countyFile),
          ContentType: "application/json; charset=utf-8",
          CacheControl: "max-age=60",
        };

        await s3.putObject(destinationParams).promise();
        console.log(
          `Finished uploading results for ${countyName} to S3: counties/${countyFilename}`
        );
      } catch (error) {
        console.log(error);
      }
    });

    await Promise.all(collectCounties);

    console.log("Total MyTurn API call count: " + MYTURN_API_COUNT);
    callback(null, {
      statusCode: 200,
      body: `Successfully uploaded updates to ${collectCounties.length} counties.`,
    });
  } catch (err) {
    console.log(err);
    callback(null, {
      statusCode: 500,
      body: "ERROR",
    });
  }
};
