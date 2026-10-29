import { AIRLINE_COPY, LOCALE_DATA } from './locales.js';
// Shared route and copy for both still-image designs.
export const DEPARTURES = [
  { label: 'Nederland · Amsterdam', origin: 'Amsterdam', originCode: 'AMS', language: 'NL' },
  { label: 'France · Paris', origin: 'Paris', originCode: 'CDG', language: 'FR' },
  { label: 'United Kingdom · London', origin: 'London', originCode: 'LHR', language: 'EN' },
  { label: 'Belgique · Bruxelles', origin: 'Brussels', originCode: 'BRU', language: 'FR' },
  { label: 'Deutschland · Frankfurt', origin: 'Frankfurt', originCode: 'FRA', language: 'DE' },
  { label: 'España · Madrid', origin: 'Madrid', originCode: 'MAD', language: 'ES' },
];
export const LANGUAGES = ['EN', 'NL', 'FR', 'DE', 'ES'];

// [key, editor label, English default, maximum length]
export const COPY_FIELDS = [
  ['tagline', 'Slogan', 'A little further. A little freer.', 100],
  ['navBook', 'Navigatie: boeken', 'Book a flight', 35],
  ['navDestinations', 'Navigatie: bestemmingen', 'Destinations', 35],
  ['navTrips', 'Navigatie: boekingen', 'My bookings', 35],
  ['navHelp', 'Navigatie: hulp', 'Help', 25],
  ['heroEyebrow', 'Kopregel', 'YOUR NEXT CHAPTER', 60],
  ['heroTitle', 'Titel boven bestemming', 'Next stop,', 50],
  ['heroSubtitle', 'Ondertitel', 'New streets. New stories. One unforgettable city.', 140],
  ['heroButton', 'Knop op de banner', 'Explore the city', 35],
  ['bookingTitle', 'Zoekvenster: titel', 'Where will you go next?', 70],
  ['oneWay', 'Enkele reis', 'One way', 30],
  ['from', 'Vertrek', 'From', 30],
  ['to', 'Bestemming', 'To', 30],
  ['dateLabel', 'Datum', 'Date', 30],
  ['passengers', 'Reizigers', 'Passengers', 30],
  ['passengerCount', 'Aantal reizigers: volwassene', '1 adult', 35],
  ['childPassengerCount', 'Aantal reizigers: kind', '1 child', 35],
  ['ticketTypeLabel', 'Ticket: tickettypelabel', 'Ticket type', 35],
  ['adultTicket', 'Ticket: volwassene', 'Adult', 35],
  ['childTicket', 'Ticket: kind', 'Child', 35],
  ['search', 'Zoekknop', 'Search flights', 35],
  ['featured', 'Vluchtsectie: titel', 'Choose your flight', 90],
  ['direct', 'Vluchttype', 'Direct flight', 40],
  ['fareLabel', 'Prijs: label', 'One way from', 35],
  ['fareNote', 'Prijs: toelichting', 'All taxes included', 45],
  ['select', 'Vlucht: knop', 'Select flight', 35],
  ['boardingPass', 'Ticket: titel', 'BOARDING PASS', 40],
  ['passengerLabel', 'Ticket: reizigerslabel', 'Passenger', 35],
  ['flightLabel', 'Ticket: vluchtnummerlabel', 'Flight', 30],
  ['boardingLabel', 'Ticket: instaptijdlabel', 'Boarding', 30],
  ['departureLabel', 'Ticket: vertrektijdlabel', 'Departure', 30],
  ['arrivalLabel', 'Ticket: aankomsttijdlabel', 'Arrival', 30],
  ['gateLabel', 'Ticket: gatelabel', 'Gate', 25],
  ['seatLabel', 'Ticket: stoellabel', 'Seat', 25],
  ['classLabel', 'Ticket: reisklasselabel', 'Class', 25],
  ['referenceLabel', 'Ticket: boekingslabel', 'Booking reference', 40],
  ['confirmed', 'Ticket: status', 'CONFIRMED', 30],
  ['ticketNote', 'Ticket: voetregel', 'Please be at the gate before boarding closes.', 110],
];

export const DEFAULT_AIRLINE_OPTS = {
  design: 'website', language: 'EN', airline: 'Airline', origin: 'London', originCode: 'LHR',
  destination: 'Berlin', destinationCode: 'BER', date: '18 JUN 2027',
  departure: '09:40', arrival: '11:05', boarding: '09:10', flight: 'FL 204',
  passenger: '', ticketType: 'adult', gate: 'B12', seat: '14A', cabin: 'Economy', reference: 'FL7K2P',
  fare: '€ 89', duration: '1h 25m', accent: '#2259dd', format: 'png', scale: 1,
  ...Object.fromEntries(COPY_FIELDS.map(([key, , value]) => [key, value])),
};

const OTHER_FLIGHTS = [
  { flight: 'FL 206', departure: '13:20', arrival: '14:45', fare: '€ 109', duration: '1h 25m' },
  { flight: 'FL 208', departure: '18:10', arrival: '19:35', fare: '€ 129', duration: '1h 25m' },
];
const copyLimits = Object.fromEntries(COPY_FIELDS.map(([key, , , max]) => [key, max]));
const clean = (value, max = 80) => value.replace(/[\r\n\t]/g, ' ').slice(0, max);

export function normalizeAirlineOpts(raw = {}) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const language = LANGUAGES.includes(input.language) ? input.language : 'EN';
  const out = { ...DEFAULT_AIRLINE_OPTS, ...AIRLINE_COPY[language], ...LOCALE_DATA[language] };
  for (const [key, fallback] of Object.entries(out)) {
    if (typeof fallback === 'string' && typeof input[key] === 'string') {
      out[key] = clean(input[key], copyLimits[key] || 80);
    }
  }
  out.design = input.design === 'ticket' ? 'ticket' : 'website';
  out.ticketType = input.ticketType === 'child' ? 'child' : 'adult';
  out.language = language;
  out.accent = /^#[a-f\d]{6}$/i.test(input.accent) ? input.accent : DEFAULT_AIRLINE_OPTS.accent;
  out.format = input.format === 'jpg' ? 'jpg' : 'png';
  out.scale = Number(input.scale) === 2 ? 2 : 1;
  // Upgrade the old English-only defaults while retaining hand-written copy.
  if (input.localeVersion !== 1) {
    for (const [key, , english] of COPY_FIELDS) {
      if (input[key] === english || (key === 'featured' && input[key] === 'Your city escape starts here.')) out[key] = AIRLINE_COPY[language][key];
    }
    if (input.origin === 'Amsterdam' && language !== 'NL') {
      out.origin = LOCALE_DATA[language].origin; out.originCode = LOCALE_DATA[language].originCode;
    }
  }
  if (out.airline === 'AEROVIA') out.airline = 'Airline';
  out.localeVersion = 1;
  out.languageCopies = {};
  for (const lang of LANGUAGES) {
    const saved = input.languageCopies?.[lang];
    if (!saved || typeof saved !== 'object') continue;
    out.languageCopies[lang] = {};
    for (const [key] of COPY_FIELDS) if (typeof saved[key] === 'string') out.languageCopies[lang][key] = clean(saved[key], copyLimits[key]);
  }
  out.otherFlights = OTHER_FLIGHTS.map((fallback, i) => Object.fromEntries(Object.entries(fallback).map(([key, value]) => [
    key, typeof input.otherFlights?.[i]?.[key] === 'string' ? clean(input.otherFlights[i][key]) : value,
  ])));
  return out;
}

export function setAirlineLanguage(raw, language) {
  const current = normalizeAirlineOpts(raw);
  if (!LANGUAGES.includes(language) || current.language === language) return current;
  const languageCopies = structuredClone(current.languageCopies);
  languageCopies[current.language] = Object.fromEntries(COPY_FIELDS.map(([key]) => [key, current[key]]));
  const data = LOCALE_DATA[language];
  const next = { ...current, ...AIRLINE_COPY[language], ...languageCopies[language], language, languageCopies,
    origin: data.origin, originCode: data.originCode };
  // Translate standard place names and values, preserving free-form custom data.
  for (const key of ['destination', 'date', 'cabin']) {
    if (Object.values(LOCALE_DATA).some(locale => locale[key] === current[key])) next[key] = data[key];
  }
  return normalizeAirlineOpts(next);
}

export function getAirlineFlights(raw) {
  const opts = normalizeAirlineOpts(raw);
  return [opts, ...opts.otherFlights].map(flight => ({
    flight: flight.flight, departure: flight.departure, arrival: flight.arrival, fare: flight.fare, duration: flight.duration,
    origin: opts.origin, originCode: opts.originCode, destination: opts.destination, destinationCode: opts.destinationCode,
  }));
}

export function imageDimensions(opts) {
  const { design, scale } = normalizeAirlineOpts(opts);
  return design === 'ticket' ? { width: 1600 * scale, height: 800 * scale } : { width: 1920 * scale, height: 1080 * scale };
}
