import { Component, OnInit } from '@angular/core';

@Component({
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.css']
})
export class HomePageComponent implements OnInit {
  
  pageTitle = "Welcome to Tiger Talks!";
  
  constructor() { }

  ngOnInit(): void {
  }

}