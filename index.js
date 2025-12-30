require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cron = require("node-cron");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --------------------- In-memory storage ---------------------
let badges = []; // ["React", "Node.js", "Python"]
let questions = []; // { id, userId, text, badge, timestamp, bestAnswer: { userId, points } }
let weeklyPoints = {}; // { badge: { userId: points } }
let allTimePoints = {}; // { badge: { userId: points } }

// --------------------- Helper Functions ---------------------
async function postToSlack(message, channel) {
  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { 
      text: message,
      channel: channel 
    });
  } catch (err) {
    console.error("Error posting to Slack:", err);
  }
}

function resetWeeklyPoints() {
  weeklyPoints = {};
}

function getUserMention(userId) {
  return `<@${userId}>`;
}

// --------------------- Scheduled Tasks ---------------------
// Post leaderboard every Monday at 9 AM
cron.schedule("0 9 * * 1", async () => {
  console.log("Running weekly leaderboard post...");
  
  for (const badge of badges) {
    const points = weeklyPoints[badge] || {};
    const topUsers = Object.entries(points)
      .map(([userId, pts]) => ({ userId, points: pts }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);
    
    if (topUsers.length > 0) {
      const leaderboard = topUsers
        .map((entry, idx) => `${idx + 1}. ${getUserMention(entry.userId)}: ${entry.points} pts`)
        .join("\n");
      
      await postToSlack(
        `📊 *Weekly Leaderboard for ${badge}*\n\n${leaderboard}\n\n_Resetting for next week..._`
      );
    }
  }
  
  resetWeeklyPoints();
});

// --------------------- Slack Commands ---------------------
app.post("/slack/commands", async (req, res) => {
  const { command, text, user_id, user_name, channel_id } = req.body;
  res.send(""); // Must respond within 3s

  try {
    switch (command) {
      // ---------------- /domain ----------------
      case "/domain": {
        const badgeName = text.trim();
        if (!badgeName) {
          await postToSlack("❌ Please provide a badge name. Usage: `/domain [badge name]`");
          break;
        }
        
        if (badges.includes(badgeName)) {
          await postToSlack(`❌ Badge "${badgeName}" already exists.`);
          break;
        }
        
        badges.push(badgeName);
        weeklyPoints[badgeName] = {};
        allTimePoints[badgeName] = {};
        
        await postToSlack(
          `🎯 *New badge created!*\n` +
          `Badge: *${badgeName}*\n` +
          `Created by: ${getUserMention(user_id)}\n` +
          `Total badges: ${badges.length}`
        );
        break;
      }

      // ---------------- /addbadge ----------------
      case "/addbadge": {
        const badgeName = text.trim();
        if (!badgeName) {
          await postToSlack("❌ Please provide a badge name. Usage: `/addbadge [badge name]`");
          break;
        }
        
        if (badges.includes(badgeName)) {
          await postToSlack(`❌ Badge "${badgeName}" already exists.`);
          break;
        }
        
        badges.push(badgeName);
        weeklyPoints[badgeName] = {};
        allTimePoints[badgeName] = {};
        
        await postToSlack(
          `🏅 *New badge added!*\n` +
          `Badge: *${badgeName}*\n` +
          `Added by: ${getUserMention(user_id)}`
        );
        break;
      }

      // ---------------- /question ----------------
      case "/question": {
        // Format: /question [badge] [question text] @user1 @user2
        const parts = text.trim().split(/\s+/);
        if (parts.length < 2) {
          await postToSlack("❌ Usage: `/question [badge] [question] @user1 @user2...`");
          break;
        }
        
        const badge = parts[0];
        const restText = parts.slice(1).join(" ");
        
        // Extract mentioned users
        const mentionPattern = /<@([A-Z0-9]+)(\|[^>]+)?>/g;
        const mentions = [...restText.matchAll(mentionPattern)].map(m => m[1]);
        
        // Remove mentions from question text
        const questionText = restText.replace(mentionPattern, "").trim();
        
        if (!badges.includes(badge)) {
          await postToSlack(`❌ Badge "${badge}" doesn't exist. Create it first with \`/domain ${badge}\``);
          break;
        }
        
        const questionId = questions.length + 1;
        questions.push({
          id: questionId,
          userId: user_id,
          text: questionText,
          badge: badge,
          timestamp: Date.now(),
          mentionedUsers: mentions,
          bestAnswer: null
        });
        
        const mentionsList = mentions.length > 0 
          ? mentions.map(id => getUserMention(id)).join(" ") 
          : "";
        
        await postToSlack(
          `❓ *New Question [#${questionId}]*\n` +
          `Badge: *${badge}*\n` +
          `Asked by: ${getUserMention(user_id)}\n` +
          `Question: ${questionText}\n` +
          (mentionsList ? `Tagged: ${mentionsList}` : "")
        );
        break;
      }

      // ---------------- /best-answer ----------------
      case "/best-answer": {
        // Format: /best-answer [question-id] @user [points]
        const parts = text.trim().split(/\s+/);
        if (parts.length < 3) {
          await postToSlack("❌ Usage: `/best-answer [question-id] @user [points]`");
          break;
        }
        
        const questionId = parseInt(parts[0]);
        const userMatch = parts[1].match(/<@([A-Z0-9]+)(\|[^>]+)?>/);
        const points = parseInt(parts[2]);
        
        if (!userMatch || isNaN(points)) {
          await postToSlack("❌ Invalid format. Usage: `/best-answer [question-id] @user [points]`");
          break;
        }
        
        const answererUserId = userMatch[1];
        const question = questions.find(q => q.id === questionId);
        
        if (!question) {
          await postToSlack(`❌ Question #${questionId} not found.`);
          break;
        }
        
        if (question.userId !== user_id) {
          await postToSlack(`❌ Only the question asker can mark the best answer.`);
          break;
        }
        
        if (question.bestAnswer) {
          await postToSlack(`❌ Question #${questionId} already has a best answer.`);
          break;
        }
        
        // Award points
        question.bestAnswer = { userId: answererUserId, points: points };
        
        if (!weeklyPoints[question.badge]) weeklyPoints[question.badge] = {};
        if (!allTimePoints[question.badge]) allTimePoints[question.badge] = {};
        
        weeklyPoints[question.badge][answererUserId] = 
          (weeklyPoints[question.badge][answererUserId] || 0) + points;
        allTimePoints[question.badge][answererUserId] = 
          (allTimePoints[question.badge][answererUserId] || 0) + points;
        
        await postToSlack(
          `🏆 *Best Answer Awarded!*\n` +
          `Question #${questionId}: "${question.text}"\n` +
          `Badge: *${question.badge}*\n` +
          `Winner: ${getUserMention(answererUserId)}\n` +
          `Points: *${points}*\n` +
          `Awarded by: ${getUserMention(user_id)}`
        );
        break;
      }

      // ---------------- /leaderboard ----------------
      case "/leaderboard": {
        const badge = text.trim();
        
        if (badge && !badges.includes(badge)) {
          await postToSlack(`❌ Badge "${badge}" doesn't exist.`);
          break;
        }
        
        if (badge) {
          // Show leaderboard for specific badge
          const points = weeklyPoints[badge] || {};
          const topUsers = Object.entries(points)
            .map(([userId, pts]) => ({ userId, points: pts }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);
          
          if (topUsers.length === 0) {
            await postToSlack(`📊 No points awarded yet for *${badge}* this week.`);
            break;
          }
          
          const leaderboard = topUsers
            .map((entry, idx) => `${idx + 1}. ${getUserMention(entry.userId)}: ${entry.points} pts`)
            .join("\n");
          
          await postToSlack(
            `📊 *Weekly Leaderboard for ${badge}*\n\n${leaderboard}`
          );
        } else {
          // Show table of all badges with top person
          if (badges.length === 0) {
            await postToSlack("📊 No badges created yet.");
            break;
          }
          
          let table = "*Badge | Top Person | Points*\n";
          table += "━━━━━━━━━━━━━━━━━━━━━━━━\n";
          
          for (const badge of badges) {
            const points = weeklyPoints[badge] || {};
            const topUser = Object.entries(points)
              .map(([userId, pts]) => ({ userId, points: pts }))
              .sort((a, b) => b.points - a.pts)[0];
            
            if (topUser) {
              table += `${badge} | ${getUserMention(topUser.userId)} | ${topUser.points}\n`;
            } else {
              table += `${badge} | _No activity_ | 0\n`;
            }
          }
          
          await postToSlack(`📊 *Weekly Leaderboard - All Badges*\n\n${table}`);
        }
        break;
      }

      // ---------------- /badges ----------------
      case "/badges": {
        if (badges.length === 0) {
          await postToSlack("🏅 No badges created yet. Use `/domain [badge name]` to create one.");
          break;
        }
        
        await postToSlack(`🏅 *Available Badges:*\n${badges.map(b => `• ${b}`).join("\n")}`);
        break;
      }

      default:
        await postToSlack(`❌ Unknown command: ${command}`);
    }
  } catch (err) {
    console.error("Error handling command:", err);
    await postToSlack(`❌ Error processing command ${command}: ${err.message}`);
  }
});

// --------------------- Slack Interactivity (Autocomplete) ---------------------
app.post("/slack/interactivity", async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);

    if (payload.type === "block_suggestion") {
      const { name, value } = payload;
      let options = [];

      // Autocomplete for badge names
      if (name === "badge") {
        options = badges
          .filter(b => b.toLowerCase().includes(value.toLowerCase()))
          .map(b => ({ 
            text: { type: "plain_text", text: b }, 
            value: b 
          }));
      } 
      // Autocomplete for questions
      else if (name === "question") {
        options = questions
          .filter(q => {
            const searchStr = `${q.id} ${q.badge} ${q.text}`.toLowerCase();
            return searchStr.includes(value.toLowerCase());
          })
          .slice(0, 20) // Limit to 20 results
          .map(q => ({
            text: { 
              type: "plain_text", 
              text: `#${q.id} | ${q.badge} | ${q.text.substring(0, 50)}...` 
            },
            value: `${q.id}`
          }));
      }

      return res.json({ options });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Interactivity error:", err);
    res.sendStatus(500);
  }
});

// --------------------- Start Server ---------------------
app.listen(PORT, () => {
  console.log(`🚀 Slack Badge App running on port ${PORT}`);
  console.log(`📅 Weekly leaderboard scheduled for Mondays at 9 AM`);
});
