require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --------------------- In-memory storage ---------------------
let kudos = {}; // { userId: points }
let users = {}; // { userId: { badges: [] } }
let questions = []; // { id, userId, text, badge, answeredBy: [], bestAnswer: null }
let badgesList = ["React", "Node.js", "Python"]; // Predefined badges

// --------------------- Helper ---------------------
async function postToSlack(message) {
  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { text: message });
  } catch (err) {
    console.error("Error posting to Slack:", err);
  }
}

// --------------------- /slack/commands ---------------------
app.post("/slack/commands", async (req, res) => {
  const { command, text, user_id, user_name } = req.body;
  res.send(""); // Must respond <3s

  try {
    switch (command) {
      // ---------------- /kudos ----------------
      case "/kudos": {
        kudos[user_id] = (kudos[user_id] || 0) + 5;
        await postToSlack(
          `:tada: Kudos to <@${user_id}>!\n========\nWhy: ${text}\n5 points! 🎉\nTotal: ${kudos[user_id]}`
        );
        break;
      }

      // ---------------- /addbadge ----------------
      case "/addbadge": {
        const badge = text.trim();
        if (!badge) {
          await postToSlack("❌ Please provide a badge name.");
          break;
        }
        if (!users[user_id]) users[user_id] = { badges: [] };
        if (!users[user_id].badges.includes(badge)) users[user_id].badges.push(badge);
        if (!badgesList.includes(badge)) badgesList.push(badge);
        await postToSlack(
          `🏅 <@${user_id}> added badge: ${badge}\nYour badges: ${users[user_id].badges.join(", ")}`
        );
        break;
      }

      // ---------------- /question ----------------
      case "/question": {
        const [badge, ...questionParts] = text.split("|").map(s => s.trim());
        if (!badge || questionParts.length === 0) {
          await postToSlack("❌ Usage: /question [badge] | [your question]");
          break;
        }
        const questionText = questionParts.join(" ");
        const questionId = questions.length + 1;
        questions.push({
          id: questionId,
          userId: user_id,
          text: questionText,
          badge,
          answeredBy: [],
          bestAnswer: null
        });
        await postToSlack(`❓ <@${user_id}> asked a question for badge ${badge}:\n${questionText}\nQuestion ID: ${questionId}`);
        break;
      }

      // ---------------- /answer ----------------
      case "/answer": {
        const [qidStr, answerText] = text.split("|").map(s => s.trim());
        const qid = parseInt(qidStr);
        const question = questions.find(q => q.id === qid);
        if (!question) {
          await postToSlack(`❌ Question ID ${qid} not found.`);
          break;
        }
        question.answeredBy.push({ userId: user_id, answer: answerText });
        await postToSlack(`✅ <@${user_id}> answered question ID ${qid}:\n${answerText}`);
        break;
      }

      // ---------------- /best-answer ----------------
      case "/best-answer": {
        const [qidStr, bestUserTag, pointsStr] = text.split("|").map(s => s.trim());
        const qid = parseInt(qidStr);
        const points = parseInt(pointsStr);
        const question = questions.find(q => q.id === qid);
        if (!question) {
          await postToSlack(`❌ Question ID ${qid} not found.`);
          break;
        }
        question.bestAnswer = bestUserTag;
        kudos[bestUserTag] = (kudos[bestUserTag] || 0) + points;
        await postToSlack(`🏆 <@${bestUserTag}> marked as best answer for question ID ${qid} (+${points} pts)`);
        break;
      }

      // ---------------- /questions ----------------
      case "/questions": {
        const badgeFilter = text.trim();
        const filteredQuestions = badgeFilter
          ? questions.filter(q => q.badge.toLowerCase() === badgeFilter.toLowerCase())
          : questions;
        if (!filteredQuestions.length) {
          await postToSlack("❌ No questions found.");
          break;
        }
        const message = filteredQuestions
          .map(q => `ID ${q.id} | ${q.badge} | <@${q.userId}>: ${q.text}`)
          .join("\n");
        await postToSlack(`📄 Questions:\n${message}`);
        break;
      }

      // ---------------- /leaderboard ----------------
      case "/leaderboard": {
        const badgeFilter = text.trim();
        let filteredQuestions = badgeFilter
          ? questions.filter(q => q.badge.toLowerCase() === badgeFilter.toLowerCase())
          : questions;
        const leaderboardPoints = {};

        filteredQuestions.forEach(q => {
          if (q.bestAnswer) {
            leaderboardPoints[q.bestAnswer] = (leaderboardPoints[q.bestAnswer] || 0) + 1;
          }
        });

        const topUsers = Object.keys(leaderboardPoints)
          .map(u => ({ user: u, points: leaderboardPoints[u] }))
          .sort((a, b) => b.points - a.points)
          .slice(0, 10)
          .map(entry => `<@${entry.user}>: ${entry.points} pts`);

        await postToSlack(`📊 Leaderboard${badgeFilter ? ` for ${badgeFilter}` : ""}:\n${topUsers.join("\n")}`);
        break;
      }

      // ---------------- /badges ----------------
      case "/badges": {
        await postToSlack(`🏅 All badges: ${badgesList.join(", ")}`);
        break;
      }

      default:
        await postToSlack(`❌ Unknown command: ${command}`);
    }
  } catch (err) {
    console.error("Error handling command:", err);
    await postToSlack(`❌ Error processing command ${command}`);
  }
});

// --------------------- /slack/interactivity ---------------------
app.post("/slack/interactivity", async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);

    if (payload.type === "block_suggestion") {
      const { name, value } = payload;
      let options = [];

      if (name === "badge") {
        options = badgesList
          .filter(b => b.toLowerCase().includes(value.toLowerCase()))
          .map(b => ({ text: { type: "plain_text", text: b }, value: b }));
      } else if (name === "question") {
        options = questions
          .filter(q => `${q.id} ${q.badge} ${q.text}`.toLowerCase().includes(value.toLowerCase()))
          .map(q => ({
            text: { type: "plain_text", text: `ID ${q.id} | ${q.badge} | ${q.text}` },
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

// --------------------- Start server ---------------------
app.listen(PORT, () => console.log(`🚀 BadgeUp running on port ${PORT}`));
