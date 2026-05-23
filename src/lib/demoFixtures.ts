import { PlanResult } from './types';

export const demoFixtures: Record<string, PlanResult> = {
  'sf-route': {
    id: 'sf-route',
    request: {
      location: 'SF Ferry Building, San Francisco, CA',
      activity: 'Biking with Coit Tower climb',
      time: '14:30'
    },
    timestamp: '2026-05-23T14:30:00-07:00',
    verdict: 'go',
    departBy: '2026-05-23T14:30:00-07:00',
    delayUntil: null,
    headline: 'Clear to ride - wind and hill, not heat, are the real limit',
    reasoning: 'Afternoon wet-bulb holds near 56°F (white flag), so thermal load is negligible. However, expect brisk 18-25 mph westerly headwind gusts on the Golden Gate approach, fog visibility reductions, and a steep 14% grade climb on Filbert St. to Coit. Wear layers.',
    wetBulbPeakF: 56,
    flag: 'white',
    coolingStops: [
      {
        name: 'Pier 7 Rest Area',
        placeId: 'pl-pier7',
        lat: 37.8012,
        lng: -122.3975,
        distanceMeters: 600,
        why: 'Flat shoreline stretch with windbreak and bench seating',
        mapsUri: 'https://www.google.com/maps/search/?api=1&query=Pier+7+Rest+Area'
      },
      {
        name: 'Coit Tower Base plaza',
        placeId: 'pl-coit',
        lat: 37.8024,
        lng: -122.4058,
        distanceMeters: 1800,
        why: 'Top of the intense climb; fresh water fountain and restroom facilities',
        mapsUri: 'https://www.google.com/maps/search/?api=1&query=Coit+Tower+Base+plaza'
      },
      {
        name: 'Crissy Field Warming Hut Cafe',
        placeId: 'pl-crissy',
        lat: 37.8080,
        lng: -122.4702,
        distanceMeters: 5500,
        why: 'Indoor wind refuge and beverage supply right before the cold Bridge climb',
        mapsUri: 'https://www.google.com/maps/search/?api=1&query=Crissy+Field+Warming+Hut+Cafe'
      }
    ],
    spatial: {
      origin: { lat: 37.7955, lng: -122.3937, label: 'Ferry Building' },
      waypoints: [
        { lat: 37.8024, lng: -122.4058, label: 'Coit Tower' },
        { lat: 37.8199, lng: -122.4783, label: 'Golden Gate Bridge' }
      ],
      headingNote: 'Northwest along Embarcadero highway, steep climb up Filbert, then shoreline paths heading West to the Bridge.'
    },
    envNotes: [
      'Heat poses no safety constraint today.',
      'High wind hazard: 15-25 mph steady ocean westerlies.',
      'Wet-bulb temperature computed via Stull (2011) empirical formula.',
      'Flag rating assigned based on USMC 6200.1E environmental logistics standards.'
    ],
    agentTrace: [
      {
        agentName: 'WeatherSubAgent',
        status: 'success',
        durationMs: 380,
        outputSummary: 'Parsed NWS forecast showing 59°F dry bulb, 81% relative humidity, generating 55.6°F peak wet-bulb.'
      },
      {
        agentName: 'PlaceSubAgent',
        status: 'success',
        durationMs: 420,
        outputSummary: 'Scanned 3 cooling/emergency rest stops in SF: Pier 7, Coit Tower, and Crissy Field Hut.'
      },
      {
        agentName: 'SynthesisSubAgent',
        status: 'success',
        durationMs: 250,
        outputSummary: 'Synthesized plan. Thermal flag is standard white. Wind and fog warned in reasoning text.'
      }
    ]
  },
  'zilker-bike': {
    id: 'zilker-bike',
    request: {
      location: 'Zilker Park, Austin, TX',
      activity: 'Heavy Trail Biking',
      time: '13:00'
    },
    timestamp: '2026-05-23T13:00:00-05:00',
    verdict: 'delay',
    departBy: null,
    delayUntil: '2026-05-23T18:30:00-05:00',
    headline: 'High Heat Hazard - Delay cycling until evening cooling trend',
    reasoning: 'Peak wet-bulb temperature is forecast to hit 89.2°F (Red flag) between 12:00 and 16:30. At this scheduling threshold, non-adapted physical exertions should be halted. Shifting departure to 18:30 BST drops the thermal rating to a Yellow flag (84°F) for safe, shaded riding.',
    wetBulbPeakF: 89,
    flag: 'red',
    coolingStops: [
      {
        name: 'Barton Springs Pool GateHouse',
        placeId: 'pl-barton',
        lat: 30.2638,
        lng: -97.7712,
        distanceMeters: 200,
        why: '68°F natural fed pool and heavy shaded grove for active cooling',
        mapsUri: 'https://www.google.com/maps/search/?api=1&query=Barton+Springs+Pool+GateHouse'
      },
      {
        name: 'Zilker Botanical Garden Center',
        placeId: 'pl-botanical',
        lat: 30.2676,
        lng: -97.7758,
        distanceMeters: 900,
        why: 'Air-conditioned main building and continuous overhead tree cover',
        mapsUri: 'https://www.google.com/maps/search/?api=1&query=Zilker+Botanical+Garden+Center'
      }
    ],
    spatial: {
      origin: { lat: 30.2669, lng: -97.7728, label: 'Zilker Park Center' },
      waypoints: [
        { lat: 30.2638, lng: -97.7712, label: 'Barton Springs North Gate' },
        { lat: 30.2642, lng: -97.7815, label: 'Nature Science Center' }
      ],
      headingNote: 'Looping southwest trail system; avoid unshaded gravel areas on the eastern lawn during peak solar windows.'
    },
    envNotes: [
      'Critical high heat period: 11:30 to 17:00.',
      'Wet-bulb exceeds safe threshold for intense physical cycling.',
      'Reference standard: USMC 6200.1E Red Flag training freeze applied to civilian trail logistics.',
      'Wet-bulb calculations determined via Stull (2011) psychrometric conversion.'
    ],
    agentTrace: [
      {
        agentName: 'WeatherSubAgent',
        status: 'success',
        durationMs: 440,
        outputSummary: 'Retrieved Austin Open-Meteo forecast. Dry bulb 98°F, RH 71%, calculating peak wet-bulb of 89.2°F.'
      },
      {
        agentName: 'PlaceSubAgent',
        status: 'success',
        durationMs: 310,
        outputSummary: 'Found Barton Springs Pool and Botanical Center AC refuge zones.'
      },
      {
        agentName: 'SynthesisSubAgent',
        status: 'success',
        durationMs: 290,
        outputSummary: 'Flag mapped to Red. High risk of thermal overhead. Suggested delaying until 18:30 (WB drops to 84°F).'
      }
    ]
  },
  'hyde-park': {
    id: 'hyde-park',
    request: {
      location: 'Hyde Park, London, UK',
      activity: 'Casual Jogging',
      time: '12:00'
    },
    timestamp: '2026-05-23T12:00:00+01:00',
    verdict: 'go',
    departBy: '2026-05-23T12:00:00+01:00',
    delayUntil: null,
    headline: 'Ideal Jogging Conditions - Low environmental stress',
    reasoning: 'Wet-bulb peak is comfortable at 61°F (Green flag). No solar scheduling limitations. Excellent opportunity to run, though keeping a steady hydration schedule is always recommended for long-horizon loops.',
    wetBulbPeakF: 61,
    flag: 'green',
    coolingStops: [
      {
        name: 'The Serpentine Lido Cafe',
        placeId: 'pl-lido',
        lat: 51.5052,
        lng: -0.1685,
        distanceMeters: 400,
        why: 'Shaded shoreline cafe with cold refreshments and lakeside breeze',
        mapsUri: 'https://www.google.com/maps/search/?api=1&query=The+Serpentine+Lido+Cafe'
      },
      {
        name: 'Hyde Park Bandstand Oasis',
        placeId: 'pl-bandstand',
        lat: 51.5039,
        lng: -0.1581,
        distanceMeters: 1100,
        why: 'Drinking water stations and historical canopy shade',
        mapsUri: 'https://www.google.com/maps/search/?api=1&query=Hyde+Park+Bandstand+Oasis'
      }
    ],
    spatial: {
      origin: { lat: 51.5074, lng: -0.1657, label: 'Serpentine Pavilions' },
      waypoints: [
        { lat: 51.5052, lng: -0.1685, label: 'Lido Cafe Loop' },
        { lat: 51.5085, lng: -0.1540, label: 'Speakers Corner' }
      ],
      headingNote: 'Clockwise loop circling the lake; wide paved paths with standard gravel footing.'
    },
    envNotes: [
      'Very safe thermal window for exercise.',
      'Wet-bulb is 61°F, reflecting pleasant spring weather.',
      'Formula matches paper specifications of Stull (2011) at 20°C and 55% humidity.'
    ],
    agentTrace: [
      {
        agentName: 'WeatherSubAgent',
        status: 'success',
        durationMs: 320,
        outputSummary: 'Parsed UK Met Office model showing mild 68°F dry bulb, 68% relative humidity, wet-bulb 61°F.'
      },
      {
        agentName: 'PlaceSubAgent',
        status: 'success',
        durationMs: 390,
        outputSummary: 'Identified Serpentine Lido Cafe and historical Bandstand watering points.'
      },
      {
        agentName: 'SynthesisSubAgent',
        status: 'success',
        durationMs: 180,
        outputSummary: 'Green flag active. Solid outdoor schedule.'
      }
    ]
  }
};
