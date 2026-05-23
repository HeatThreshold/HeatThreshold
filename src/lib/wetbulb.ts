/**
 * Stull (2011) Wet-Bulb Temperature Psychrometric Formula
 * Calculates wet-bulb temperature Tw (°C) given dry-bulb temperature T (°C) and relative humidity RH (%).
 * Valid for relative humidity from 5% to 99% and air temperatures from -20°C to 50°C.
 * 
 * Tw = T * atan(0.151977 * (RH + 8.313765)^0.5) 
 *      + atan(T + RH) 
 *      - atan(RH - 1.676331) 
 *      + 0.00391838 * (RH)^1.5 * atan(0.023101 * RH) 
 *      - 4.686035
 */

export function calculateWetBulbCelsius(tempC: number, rh: number): number {
  // Clamp RH to valid meteorological limits to prevent NaN
  const clampedRh = Math.max(5, Math.min(100, rh));
  
  const term1 = tempC * Math.atan(0.151977 * Math.pow(clampedRh + 8.313765, 0.5));
  const term2 = Math.atan(tempC + clampedRh);
  const term3 = Math.atan(clampedRh - 1.676331);
  const term4 = 0.00391838 * Math.pow(clampedRh, 1.5) * Math.atan(0.023101 * clampedRh);
  
  const wetBulbC = term1 + term2 - term3 + term4 - 4.686035;
  return wetBulbC;
}

export function fahrenheitToCelsius(tempF: number): number {
  return ((tempF - 32) * 5) / 9;
}

export function celsiusToFahrenheit(tempC: number): number {
  return (tempC * 9) / 5 + 32;
}

/**
 * Calculates wet-bulb temperature in Fahrenheit given dry-bulb in Fahrenheit and relative humidity in %.
 */
export function calculateWetBulbFahrenheit(tempF: number, rh: number): number {
  const tempC = fahrenheitToCelsius(tempF);
  const wetBulbC = calculateWetBulbCelsius(tempC, rh);
  return celsiusToFahrenheit(wetBulbC);
}
