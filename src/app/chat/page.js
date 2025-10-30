"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/navigation";
import io from "socket.io-client";

const API_URL = "http://localhost:5001";
let socket;

// A default avatar component
const Avatar = ({ src, username, size = "10" }) => {
  const SIZES = {
    8: "h-8 w-8",
    10: "h-10 w-10",
    12: "h-12 w-12",
  };

  if (src) {
    return (
      <img
        src={src}
        alt={username}
        className={`${SIZES[size]} rounded-full object-cover flex-shrink-0`}
      />
    );
  }

  // Placeholder if no avatar
  const initial = username ? username[0].toUpperCase() : "?";
  return (
    <div
      className={`${SIZES[size]} rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold flex-shrink-0`}
    >
      {initial}
    </div>
  );
};

export default function ChatPage() {
  const { user, token, logout, loading } = useAuth();
  const router = useRouter();

  const [pendingRequests, setPendingRequests] = useState([]);
  const [friends, setFriends] = useState([]);
  const [selectedFriend, setSelectedFriend] = useState(null);

  const [currentChatId, setCurrentChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");

  const [searchUsername, setSearchUsername] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [message, setMessage] = useState("");

  const socketRef = useRef(null);
  const chatBottomRef = useRef(null);

  const authedFetch = (url, options = {}) => {
    // Note: Can't be used for FormData, only JSON
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
    if (user && token) {
      fetchFriendData();
    }
  }, [user, loading, router, token]);

  useEffect(() => {
    if (user) {
      socketRef.current = io(API_URL);

      socketRef.current.on("receiveMessage", (incomingMessage) => {
        if (incomingMessage.chatId === currentChatId) {
          setMessages((prevMessages) => [...prevMessages, incomingMessage]);
        }
      });

      return () => {
        socketRef.current.disconnect();
      };
    }
  }, [user, currentChatId]);

  const fetchFriendData = async () => {
    if (!token) return;
    try {
      const [pendingRes, friendsRes] = await Promise.all([
        authedFetch(`${API_URL}/friends/pending`),
        authedFetch(`${API_URL}/friends/all`),
      ]);
      if (pendingRes.ok) setPendingRequests(await pendingRes.json());
      if (friendsRes.ok) setFriends(await friendsRes.json());
    } catch (err) {
      showMessage("Error fetching data.");
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchUsername) return;
    try {
      // Need to use authedFetch for this protected route
      const res = await authedFetch(
        `${API_URL}/users/find?username=${searchUsername}`
      );
      const data = await res.json();
      if (res.ok && data.length > 0) {
        setSearchResult(data[0]);
      } else {
        setSearchResult(null);
        showMessage(data.error || "User not found.");
      }
    } catch (err) {
      showMessage("Search error.");
    }
  };

  const sendFriendRequest = async () => {
    if (!searchResult) return;
    try {
      const res = await authedFetch(`${API_URL}/friends/request`, {
        method: "POST",
        body: JSON.stringify({ receiverId: searchResult.id }),
      });
      const data = await res.json();
      showMessage(
        res.ok ? `Friend request sent to ${searchResult.username}` : data.error
      );
      setSearchResult(null);
      setSearchUsername("");
    } catch (err) {
      showMessage("Error sending request.");
    }
  };

  const handleRequestResponse = async (friendshipId, status) => {
    try {
      const res = await authedFetch(`${API_URL}/friends/respond`, {
        method: "PUT",
        body: JSON.stringify({ friendshipId, status }),
      });
      const data = await res.json();
      if (res.ok) {
        showMessage(`Request ${status.toLowerCase()}`);
        fetchFriendData();
      } else {
        showMessage(data.error);
      }
    } catch (err) {
      showMessage("Error responding to request.");
    }
  };

  const handleSelectFriend = async (friend) => {
    setSelectedFriend(friend);
    try {
      const res = await authedFetch(`${API_URL}/chats/find/${friend.id}`);
      if (!res.ok) throw new Error("Could not fetch chat history");
      const chat = await res.json();
      setMessages(chat.messages);
      setCurrentChatId(chat.id);
      socketRef.current.emit("joinRoom", chat.id);
    } catch (error) {
      showMessage(error.message);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentChatId || !socketRef.current) return;

    const messagePayload = {
      chatId: currentChatId,
      authorId: user.id,
      content: newMessage,
    };
    socketRef.current.emit("sendMessage", messagePayload);

    // Optimistic update
    setMessages((prev) => [
      ...prev,
      {
        ...messagePayload,
        author: {
          id: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
        },
      }, // <-- AVATAR
    ]);
    setNewMessage("");
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 3000);
  };

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* --- Left Panel --- */}
      <div className="w-1/3 flex flex-col border-r border-gray-700 bg-gray-800">
        {/* User Info & Logout */}
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Avatar src={user.avatarUrl} username={user.username} />{" "}
            {/* <-- AVATAR */}
            <h2 className="text-lg font-semibold">Welcome, {user.username}</h2>
          </div>
          <button
            onClick={logout}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-sm"
          >
            Logout
          </button>
        </div>

        {/* Find Friend */}
        <div className="p-4 border-b border-gray-700">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              placeholder="Find friend by username"
              value={searchUsername}
              onChange={(e) => setSearchUsername(e.target.value)}
              className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none"
            />
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-md"
            >
              Search
            </button>
          </form>
          {searchResult && (
            <div className="mt-2 p-2 bg-gray-700 rounded-md flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Avatar
                  src={searchResult.avatarUrl}
                  username={searchResult.username}
                  size="8"
                />{" "}
                {/* <-- AVATAR */}
                <span>{searchResult.username}</span>
              </div>
              <button
                onClick={sendFriendRequest}
                className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-md text-sm"
              >
                Send Request
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Area for Requests & Friends */}
        <div className="flex-1 overflow-y-auto">
          {/* Pending Requests */}
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-200 mb-2">
              Pending Requests
            </h3>
            <ul className="space-y-2">
              {pendingRequests.length === 0 && (
                <li className="text-gray-400 text-sm">No pending requests.</li>
              )}
              {pendingRequests.map((req) => (
                <li
                  key={req.id}
                  className="flex justify-between items-center bg-gray-700 p-2 rounded-md"
                >
                  <div className="flex items-center gap-2">
                    <Avatar
                      src={req.requester.avatarUrl}
                      username={req.requester.username}
                      size="8"
                    />{" "}
                    {/* <-- AVATAR */}
                    <span>{req.requester.username}</span>
                  </div>
                  <div className="space-x-2 flex-shrink-0">
                    <button
                      onClick={() => handleRequestResponse(req.id, "ACCEPTED")}
                      className="bg-green-600 hover:bg-green-700 px-2 py-1 rounded-md text-sm"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRequestResponse(req.id, "DECLINED")}
                      className="bg-red-600 hover:bg-red-700 px-2 py-1 rounded-md text-sm"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Friends List */}
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-200 mb-2">
              Friends
            </h3>
            <ul className="space-y-2">
              {friends.length === 0 && (
                <li className="text-gray-400 text-sm">No friends yet.</li>
              )}
              {friends.map((friend) => (
                <li
                  key={friend.id}
                  onClick={() => handleSelectFriend(friend)}
                  className={`p-2 rounded-md cursor-pointer flex items-center gap-3 ${
                    selectedFriend?.id === friend.id
                      ? "bg-blue-600"
                      : "bg-gray-700 hover:bg-gray-600"
                  }`}
                >
                  <Avatar
                    src={friend.avatarUrl}
                    username={friend.username}
                    size="8"
                  />{" "}
                  {/* <-- AVATAR */}
                  {friend.username}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* --- Right Panel (Chat) --- */}
      <div className="w-2/3 flex flex-col bg-gray-900">
        {selectedFriend ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-700 bg-gray-800 flex items-center gap-3">
              <Avatar
                src={selectedFriend.avatarUrl}
                username={selectedFriend.username}
              />{" "}
              {/* <-- AVATAR */}
              <h2 className="text-xl font-semibold">
                Chat with {selectedFriend.username}
              </h2>
            </div>

            {/* Chat Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id || Math.random()}
                  className={`flex gap-3 ${
                    msg.authorId === user.id ? "justify-end" : "justify-start"
                  }`}
                >
                  {/* Show avatar for the other user */}
                  {msg.authorId !== user.id && (
                    <Avatar
                      src={msg.author.avatarUrl}
                      username={msg.author.username}
                    /> // {/* <-- AVATAR */}
                  )}

                  <div className="flex flex-col max-w-xs">
                    <span
                      className={`text-xs text-gray-400 mb-1 ${
                        msg.authorId === user.id ? "text-right" : "text-left"
                      }`}
                    >
                      {msg.author.username}
                    </span>
                    <div
                      className={`p-3 rounded-lg ${
                        msg.authorId === user.id ? "bg-blue-600" : "bg-gray-700"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>

                  {/* Show avatar for the logged-in user */}
                  {msg.authorId === user.id && (
                    <Avatar
                      src={msg.author.avatarUrl}
                      username={msg.author.username}
                    /> // {/* <-- AVATAR */}
                  )}
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input */}
            <form
              onSubmit={handleSendMessage}
              className="p-4 border-t border-gray-700 bg-gray-800 flex gap-2"
            >
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:outline-none"
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-md"
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-gray-400">
            <div>
              <h2 className="text-2xl">Welcome to your Chat App</h2>
              <p>Select a friend from the list to start a conversation.</p>
            </div>
          </div>
        )}
      </div>

      {/* GLOBAL MESSAGE TOAST */}
      {message && (
        <div className="absolute bottom-5 right-5 bg-green-500 text-white px-4 py-2 rounded-md shadow-lg">
          {message}
        </div>
      )}
    </div>
  );
}
