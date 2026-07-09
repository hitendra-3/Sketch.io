import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './app/page';
import BoardPage from './app/board/[roomId]/page';
import './app/globals.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/board/:roomId" element={<BoardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
