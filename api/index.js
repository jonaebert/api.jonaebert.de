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
            // Fehlt noch Implementierung für maxitems
            blogResp = await fetch(`${cmsBaseURI}/api/articles?populate=cover&populate=copyright&populate[author][populate]=avatar&sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=${blogMaxItems}`, {
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
      const calIcalUrl = 'https://wolke.jonaebert.de/remote.php/dav/public-calendars/KawfLgSTT68H2dLy?export';
      const calNow = new Date();
      const calLater = new Date(calNow.getFullYear(), calNow.getMonth() + 3, calNow.getDate() + 1);
      const calMaxItems = c.req.queries('maxitems')?.shift() || '93';

      let calResp = [];

      try {
        calResp = await fetch(calIcalUrl, {
          headers: {
            'User-Agent': 'Jona Ebert/1.0'
          }
        });
        const calRespText = await calResp.text();
        const calData = parseICS(calRespText);
        let calEvents = [];

        // Handle (recurrend) events
        for (const calEvent of Object.values(calData)) {
          if (calEvent.type === 'VEVENT') {
            let calOccurrences = [];
            if (calEvent.rrule) {
              const calRule = rrulestr(calEvent.rrule.toString(), { dtstart: calEvent.start });
              calOccurrences = calRule.between(calNow, calLater, true).map(calDate => ({
                ...calEvent,
                start: calData,
                end: new Date(calData.getTime() + (calEvent.end - calEvent.start))
              }));
            } else if ((calEvent.start >= calNow && calEvent.start <= calLater) || (calEvent.end >= calNow && calEvent.end <= calLater)) {
              calOccurrences.push(calEvent);
            }
            calEvents.push(...calOccurrences);
          }
        }
        // Sort events
        calEvents = calEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

        // Calendar cases
        try {
          const calItemType = c.req.queries('itemtype')?.shift();

          switch (calItemType) {
            case 'all': break;

            case 'single':
              const calSingleItemUID = c.req.queries('id')?.shift();

              if (calSingleItemUID) {
                calEvents = calEvents.filter(event => event.uid === calSingleItemUID);
              } else {
                console.error('[CALENDAR] Missing ID for single event:', calSingleItemUID ? calSingleItemUID : null);
                return c.json({
                  error: 'Missing id for single event',
                  debug: { data: calEvents }
                }, 500);
              }
              if (calEvents == '') {
                console.error('[CALENDAR] Wrong ID for single event:', calSingleItemUID ? calSingleItemUID : null);
                return c.json({
                  error: 'Wrong id for single event',
                  debug: { uid: calSingleItemUID ? calSingleItemUID : null }
                }, 404);
              }
              break;

            default:
              console.error('[CALENDAR] Invalid itemtype:', calItemType ? calItemType : null);
              return c.json({
                error: 'Invalid item type',
                valid: ['all', 'single'],
                debug: { ItemType: calItemType ? calItemType : null }
              }, 400);
          }
        } catch (error) {
          console.error('[CALENDAR] Error fetching or parsing ICS file:', error);
          return c.json({
            error: 'Failed to fetch or parse ICS file',
            debug: { data: calEvents }
          }, 500);
        }

        // Slice events
        calEvents = calEvents.slice(0, calMaxItems);

        // Customize events
        calEvents = await Promise.all(calEvents.map(async calEvent => {
          // Extract Teaserimage ID
          const calTeaserImageMatch = calEvent.description?.match(/teaserimage:\s*(.+)/);
          const calTeaserImageId = calTeaserImageMatch ? calTeaserImageMatch[1] : null;
          let calCMSTeaserData = null;
          if (calTeaserImageId) {
            try {
              const cmsTeaserResp = await fetch(`${cmsBaseURI}/api/upload/files/${calTeaserImageId}?populate=*`, {
                headers: {
                  Authorization: `Bearer ${cmsAPIToken}`
                }
              });
              const calCMSTeaserJSON = await cmsTeaserResp.json();
              calCMSTeaserData = calCMSTeaserJSON;
            } catch (error) {
              console.error('[CMS] Failed to fetch event teaser image from CMS:', calTeaserImageId);
            }
          }
          const calTeaserImageData = calCMSTeaserData ? calCMSTeaserData : null;
          // Extract Teaserimage copyright text
          const calTeaserImageCopyrightTextMatch = calEvent.description?.match(/teasercopyright:\s*(.+)/);
          const calTeaserImageCopyrightText = calTeaserImageCopyrightTextMatch ? calTeaserImageCopyrightTextMatch[1] : null;
          // Extract Teaserimage copyright URI
          const calTeaserImageCopyrighUrlMatch = calEvent.description?.match(/teaserurl:\s*(.+)/);
          const calTeaserImageCopyrighUrl = calTeaserImageCopyrighUrlMatch ? calTeaserImageCopyrighUrlMatch[1] : null;

          // Extrahieren der externen Event URL
          const calEventUrlMatch = calEvent.description?.match(/eventurl:\s*(.+)/);
          const calEventUrl = calEventUrlMatch ? calEventUrlMatch[1] : null;

          // Check if event is happening now
          let calHappeningNow = false;
          if (calEvent.start <= calNow && calEvent.end >= calNow) {
            calHappeningNow = true;
          }

          // Get Description
          const calEventDescription = calEvent.description ? calEvent.description
            .replace(/teaserimage:\s*\S+\n?/, '')
            .replace(/eventurl:\s*\S+\n?/, '')
            .replace(/teasercopyright:\s*.+\n?/, '')
            .replace(/teaserurl:\s*\S+\n?/, '')
            .replace(/\n/g, '<br>')
            : null;

          return {
            id: calEvent.uid ? calEvent.uid : null,
            start: calEvent.start ? calEvent.start : null,
            end: calEvent.end ? calEvent.end : null,
            now: calHappeningNow ? calHappeningNow : false,
            datetype: calEvent.datetype ? calEvent.datetype : null,
            summary: calEvent.summary ? calEvent.summary : null,
            location: calEvent.location ? calEvent.location : null,
            description: calEventDescription,
            state: calEvent.status ? calEvent.status : "TENTATIVE",
            teaserImage: {
              // url: calTeaserImageUrl ? calTeaserImageUrl : null,
              data: calCMSTeaserData ? calTeaserImageData : null,
              copyright: {
                text: calTeaserImageCopyrightText ? calTeaserImageCopyrightText : null,
                url: calTeaserImageCopyrighUrl ? calTeaserImageCopyrighUrl : null
              }
            },
            url: calEventUrl ? calEventUrl : null
          }
        }));

        const download = c.req.queries('download')?.shift() === 'true';
        if (download) {
          const cal = ical();
          calEvents.forEach(event => {
            c.header('Content-Type', 'text/calendar');
            c.header('Content-Disposition', `attachment; filename="${event.id}.ics"`);

            cal.createEvent({
              start: event.start,
              end: event.end,
              summary: event.summary,
              description: event.description,
              location: event.location,
              uid: event.id
            });
          });
          return c.body(cal.toString());
        } else {
          return c.json({
            data: calEvents
          });
        }
      } catch (error) {
        console.error('Error fetching or parsing ICS file:', error);
        return c.json({
          error: 'Failed to fetch or parse ICS file',
          debug: {}
        }, 500);
      }
      break;

    default:
      console.error(`Invalid Type: ${c.req.queries('type')?.shift() || null}`);
      return c.json({
        error: 'Invalid or missing Type parameter',
        valid: ['blog', 'calendar'],
        debug: {
          type: c.req.queries('type')?.shift() || null
        }
      }, 500);
  }
})

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`) // Listening on http://localhost:3000
})
