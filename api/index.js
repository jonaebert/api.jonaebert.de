// Basics
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import 'dotenv/config';

// For Blog
const cmsBaseURI = process.env.JE_CMS_API_BASE_URL;
const cmsAPIToken = process.env.JE_CMS_API_TOKEN;

// For calendar
import pkg_ical from 'node-ical';
import ical from 'ical-generator';
import pkg_rrule from 'rrule';
const { parseICS } = pkg_ical;
const { rrulestr } = pkg_rrule;
const cloudBaseURI = process.env.JE_CLOUD_BASE_URI;

const app = new Hono().basePath('/api')

app.use(
  '/',
  cors({
    origin: ['*'],
    allowHeaders: ['Upgrade-Insecure-Requests'],
    allowMethods: ['GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true
  })
)

app.get('/', async (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  const type = c.req.queries('type')?.shift()

  switch (type) {
    case 'blog':
      let blogPosts = [];
      let blogResp = [];

      const blogMaxItems = c.req.queries('maxitems')?.shift() || '30'
      const blogItemType = c.req.queries('itemtype')?.shift()

      try {
        let blogJSON = '';
        switch (blogItemType) {
          case 'all':
            blogResp = await fetch(`${cmsBaseURI}/api/articles?populate[cover]=true&populate[copyright]=true&populate[author][populate][avatar]=true&sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=${blogMaxItems}`, {
              headers: {
                Authorization: `Bearer ${cmsAPIToken}`
              }
            });
            blogJSON = await blogResp.json();
            blogPosts = blogJSON.data;
            break;

          case 'post':
            const blogPostId = c.req.queries('postid')?.shift();
            blogResp = await fetch(`${cmsBaseURI}/api/articles/${blogPostId}?populate[author][populate]=avatar&populate[cover][populate]&populate[copyright][populate]=*&populate[blocks][populate]=*`, {
              headers: {
                Authorization: `Bearer ${cmsAPIToken}`
              }
            });
            blogJSON = await blogResp.json();
            blogPosts = blogJSON.data;
            break;

          default:
            console.error(`Invalid ItemType: ${c.req.queries('itemtype')?.shift() || null}`);
            return c.json({
              error: 'Invalid or missing ItemType parameter',
              valid: ['all', 'category', 'post'],
              debug: {
                type: c.req.queries('itemtype')?.shift() || null
              }
            }, 500);
        }

        return c.json({
          data: blogPosts
        });
      } catch (error) {
        console.error(error);
        return c.json({
          error: 'An error occurred',
          debug: {
            error: null
          }
        }, 500);
      }
      break;

    case 'calendar':
      let calEvents = [];
      let calResp = [];

      const calMaxItems = c.req.queries('maxitems')?.shift() || '30'
      const calItemType = c.req.queries('itemtype')?.shift()
      
      const calDateNow = encodeURIComponent(new Date().toISOString());
      const calDateLater = encodeURIComponent(new Date(new Date().setMonth(new Date().getMonth() + 3)).toISOString());

      try {
        let calJSON = '';
        switch (calItemType) {
          case 'all':
            calResp = await fetch(`${cmsBaseURI}/api/events?populate[cover]=true&filters[end][$gte]=${calDateNow}&filters[start][$lte]=${calDateLater}&sort=start:asc&pagination[page]=1&pagination[pageSize]=${calMaxItems}`, {
              headers: {
                Authorization: `Bearer ${cmsAPIToken}`
              }
            });
            calJSON = await calResp.json();
            calEvents = calJSON.data;
            break;

          case 'single':
            const calEventId = c.req.queries('eventid')?.shift();
            const calDownload = c.req.queries('download')?.shift() === 'true';
            
            // Event-Daten vom CMS holen
            calResp = await fetch(`${cmsBaseURI}/api/events/${calEventId}?populate[cover][populate]`, {
              headers: {
                Authorization: `Bearer ${cmsAPIToken}`
              }
            });
            calJSON = await calResp.json();
            calEvents = calJSON.data ? [calJSON.data] : [];

            // Set now-Flag
            calEvents = calEvents.map(event => {
              const start = new Date(event.start);
              const end = new Date(event.end);
              return {
                ...event,
                now: calDateNow >= start && calDateNow <= end
              };
            });

            // If download requested, generate and return ICS file
            if (calDownload && calEvents.length) {
              const cal = ical();
              console.log(calEvents);

              calEvents.forEach(event => {
                cal.createEvent({
                  start: event.start,
                  end: event.end,
                  summary: event.subject,
                  description: event.description,
                  location: event.location,
                  uid: event.id
                });
              });

              c.header('Content-Type', 'text/calendar');
              c.header('Content-Disposition', `attachment; filename="event-${calEventId}.ics"`);

              return c.body(cal.toString());
            }
            break;

          default:
            console.error(`Invalid ItemType: ${c.req.queries('itemtype')?.shift() || null}`);
            return c.json({
              error: 'Invalid or missing ItemType parameter',
              valid: ['all', 'single'],
              debug: {
                type: c.req.queries('itemtype')?.shift() || null
              }
            }, 500);
        }

        // Set now-flag
        const calNowDate = new Date();
        calEvents = calEvents.map(event => {
          const start = new Date(event.start);
          const end = new Date(event.end);
          return {
            ...event,
            now: calNowDate >= start && calNowDate <= end
          };
        });

        return c.json({
          data: calEvents
        });
      } catch (error) {
        console.error(error);
        return c.json({
          error: 'An error occurred',
          debug: {
            error: null
          }
        }, 500);
      }
      break;

    case 'ticker':
      let tickerItems = [];
      let tickerResp = [];

      const tickerItemType = c.req.queries('itemtype')?.shift()

      try {
        let tickerJSON = '';
        switch (tickerItemType) {
          case 'all':
            let tickerCalNow = new Date();
            let year = tickerCalNow.getFullYear();
            let month = (tickerCalNow.getMonth() + 1).toString().padStart(2, '0');
            let day = tickerCalNow.getDate().toString().padStart(2, '0');
            tickerCalNow = `${year}-${month}-${day}`;
            tickerResp = await fetch(`${cmsBaseURI}/api/tickers?sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=10&filters[startAt][$lte]=${tickerCalNow}&filters[endAt][$gte]=${tickerCalNow}`, {
              headers: {
                Authorization: `Bearer ${cmsAPIToken}`
              }
            });
            tickerJSON = await tickerResp.json();
            tickerItems = tickerJSON.data;
            break;

          case 'single':
            const tickerItemId = c.req.queries('id')?.shift();
            tickerResp = await fetch(`${cmsBaseURI}/api/tickers/${tickerItemId}`, {
              headers: {
                Authorization: `Bearer ${cmsAPIToken}`
              }
            });
            tickerJSON = await tickerResp.json();
            tickerItems = tickerJSON.data;
            break;

          default:
            console.error(`Invalid ItemType: ${c.req.queries('itemtype')?.shift() || null}`);
            return c.json({
              error: 'Invalid or missing ItemType parameter',
              valid: ['all', 'ticker'],
              debug: {
                type: c.req.queries('itemtype')?.shift() || null
              }
            }, 500);
        }

        return c.json({
          data: tickerItems
        });
      } catch (error) {
        console.error(error);
        return c.json({
          error: 'An error occurred',
          debug: {
            error: null
          }
        }, 500);
      }
      break;

    default:
      console.error(`Invalid Type: ${c.req.queries('type')?.shift() || null}`);
      return c.json({
        error: 'Invalid or missing Type parameter',
        valid: ['blog', 'calendar', 'ticker'],
        debug: {
          type: c.req.queries('type')?.shift() || null
        }
      }, 500);
  }
})

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`) // Listening on http://localhost:3000
})
