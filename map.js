import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiY29sdHJhbmVnb3dhbiIsImEiOiJjbWFwcjEyMm8wMWs3MmtvbXZoMGdmeTNwIn0.IIbsIB_tI3IdhuHmnmGk3Q';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

let timeFilter = -1;
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );
  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    const id = station.short_name;
    station.departures   = departures.get(id) ?? 0;
    station.arrivals     = arrivals.get(id)   ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;
  return trips.filter(trip => {
    const startM = minutesSinceMidnight(trip.started_at);
    const endM   = minutesSinceMidnight(trip.ended_at);
    return (
      Math.abs(startM - timeFilter) <= 60 ||
      Math.abs(endM   - timeFilter) <= 60
    );
  });
}

function formatTime(minutes) {
  const d = new Date(0, 0, 0, 0, minutes);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getCoords(station) {
  const p = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(p);
  return { cx: x, cy: y };
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  const svg = d3.select('#map').select('svg');

  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);
    let stations = jsonData.data.stations;

    const trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      d => {
        d.started_at = new Date(d.started_at);
        d.ended_at   = new Date(d.ended_at);
        return d;
      }
    );

    stations = computeStationTraffic(stations, trips);

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic)])
      .range([0, 25]);

    // initial draw
    const circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy)
        .attr('r',  d => radiusScale(d.totalTraffic))
        .style('--departure-ratio', d =>
        stationFlow(d.totalTraffic
            ? d.departures / d.totalTraffic
            : 0
        )
        );

    circles
    .append('title')
    .text(d =>
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
    );


    function updatePositions() {
      svg.selectAll('circle')
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy);
    }
    map.on('move',     updatePositions);
    map.on('zoom',     updatePositions);
    map.on('resize',   updatePositions);
    map.on('moveend',  updatePositions);

    const timeSlider   = document.getElementById('time-slider');
    const selectedTime = document.getElementById('time-display');
    const anyTimeLabel = document.getElementById('anytime');

    function updateScatterPlot(tf) {
      if (tf === -1) {
        radiusScale.range([0, 25]);
      } else {
        radiusScale.range([3, 50]);
      }

      const filteredTrips    = filterTripsByTime(trips, tf);
      const filteredStations = computeStationTraffic(stations, filteredTrips);

      svg.selectAll('circle')
    .data(filteredStations, d => d.short_name)
    .join('circle')
        .attr('cx', d => getCoords(d).cx)
        .attr('cy', d => getCoords(d).cy)
        .attr('r',  d => radiusScale(d.totalTraffic))
        .style('--departure-ratio', d =>
        stationFlow(d.totalTraffic
            ? d.departures / d.totalTraffic
            : 0
        )
        )};

    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value);

      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }

      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

  } catch (error) {
    console.error('Error loading or processing data:', error);
  }
});
